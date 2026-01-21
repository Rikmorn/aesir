/**
 * Linear AgentSession Webhook Handler
 *
 * Handles AgentSession webhooks from Linear to trigger the Dev Agent workflow.
 * When a task is delegated to the Dev Agent, Linear sends an AgentSession webhook
 * which this handler uses to start the prApprovalWorkflow in Temporal.
 */

import {
  createChildLogger,
  createPinoLogger,
  generateCorrelationId,
  type PinoLogger,
  ValidationError,
} from "@aesir/common";
import type { WebhookIdempotencyService } from "@aesir/integrations";
import {
  type ApprovalWorkflowInput,
  startApprovalWorkflow,
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "@aesir/integrations";
import type { ExecutionTracker } from "@aesir/observability";

import {
  type AgentSessionPayload,
  parseAgentSessionPayload,
} from "./schemas/index.js";

const baseLogger: PinoLogger = createPinoLogger({
  component: "agents:webhooks:linear-agent-session",
});

/**
 * Configuration for the webhook handler
 */
export interface LinearWebhookConfig {
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Slack channel ID for notifications */
  slackChannel: string;
  /** Linear status to set after successful merge */
  completionStatus:
    | "Triage"
    | "Ready"
    | "Backlog"
    | "In Progress"
    | "Done"
    | "Canceled"
    | "Duplicate";
}

/**
 * Result of handling a Linear AgentSession webhook
 */
export interface HandleAgentSessionResult {
  action:
    | "workflow_started"
    | "ignored"
    | "invalid_signature"
    | "stale_timestamp"
    | "error";
  workflowId?: string;
  taskId?: string;
  error?: string;
}

/**
 * Handle a Linear AgentSession webhook event
 *
 * @param payload - Parsed webhook payload
 * @param config - Workflow configuration
 * @param logger - Optional request-scoped logger (falls back to base logger)
 * @returns Result indicating what action was taken
 */
export async function handleAgentSessionWebhook(
  payload: AgentSessionPayload,
  config: LinearWebhookConfig,
  logger: PinoLogger = baseLogger,
): Promise<HandleAgentSessionResult> {
  const { action, agentSession } = payload;
  const taskId = agentSession.issueId;
  const sessionId = agentSession.id;

  logger.info(
    { action, taskId, sessionId },
    `AgentSession ${action} for issue ${taskId}`,
  );

  // Only handle 'created' action (new delegation)
  // 'prompted' is for follow-up messages which we don't handle yet
  if (action !== "created") {
    logger.debug({ action, taskId }, `Ignoring AgentSession action: ${action}`);
    return { action: "ignored", taskId };
  }

  // Generate workflow ID from task ID (same convention as GitHub webhook)
  const workflowId = `approval-${taskId}`;

  try {
    // Build workflow input
    const workflowInput: ApprovalWorkflowInput = {
      taskId,
      sessionId,
      owner: config.owner,
      repo: config.repo,
      slackChannel: config.slackChannel,
      completionStatus: config.completionStatus,
    };

    // Start the approval workflow
    await startApprovalWorkflow(workflowId, workflowInput);

    logger.info(
      { taskId, workflowId },
      `Started approval workflow for task ${taskId}`,
    );

    return { action: "workflow_started", workflowId, taskId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      { taskId, workflowId, err: error },
      `Failed to start workflow for task ${taskId}: ${errorMessage}`,
    );

    return { action: "error", workflowId, taskId, error: errorMessage };
  }
}

/**
 * HTTP request interface for webhook handler
 */
export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  rawBody: string;
}

/**
 * HTTP response interface for webhook handler
 */
export interface WebhookResponse {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader?: (name: string, value: string) => void;
}

/**
 * Services for webhook processing
 */
export interface WebhookServices {
  webhookIdempotency: WebhookIdempotencyService;
  executionTracker: ExecutionTracker;
  workspaceId: string;
}

/**
 * Express-style request handler for Linear AgentSession webhooks
 *
 * @param req - HTTP request with raw body string
 * @param res - HTTP response object
 * @param config - Workflow configuration
 * @param webhookSecret - Linear webhook signing secret
 * @param services - Optional services for idempotency and execution tracking
 */
export async function linearWebhookHandler(
  req: WebhookRequest,
  res: WebhookResponse,
  config: LinearWebhookConfig,
  webhookSecret: string,
  services?: WebhookServices,
): Promise<void> {
  // Generate correlation ID for this request
  const correlationId = generateCorrelationId("req");
  const logger = createChildLogger(baseLogger, { correlationId });

  const signature = req.headers["linear-signature"];

  // Verify signature
  if (
    !signature ||
    !verifyWebhookSignature(signature, req.rawBody, webhookSecret)
  ) {
    logger.warn({}, "Invalid or missing webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  logger.info({}, "Webhook signature verified");

  // Validate payload with Zod schema
  const parseResult = parseAgentSessionPayload(req.rawBody);

  if (!parseResult.success) {
    // Check if this is a non-AgentSession webhook (different type)
    // Try to parse as basic JSON to check the type field
    try {
      const basicPayload = JSON.parse(req.rawBody) as { type?: string };
      if (basicPayload.type !== "AgentSessionEvent") {
        // Not an AgentSession event - ignore without error
        logger.info(
          { type: basicPayload.type },
          `Ignoring webhook type: ${basicPayload.type}`,
        );
        res
          .status(200)
          .json({ action: "ignored", reason: "not_agent_session" });
        return;
      }
    } catch {
      // JSON parse failed - fall through to validation error
    }

    // This is an AgentSession event with invalid payload structure
    const validationError = new ValidationError(
      "AGT_WEBHOOK_VALIDATION",
      "Invalid Linear webhook payload",
      {
        validationErrors: parseResult.error.flatten(),
        metadata: { webhookType: "linear-agent-session" },
      },
    );
    logger.warn({ err: validationError }, "Webhook validation failed");
    res.status(400).json({
      error: validationError.code,
      message: validationError.message,
      details: validationError.validationErrors,
    });
    return;
  }

  const payload = parseResult.data;

  // Check idempotency after validation
  if (services?.webhookIdempotency) {
    const deliveryId = req.headers["linear-delivery"];
    if (deliveryId) {
      const { isDuplicate } = await services.webhookIdempotency.checkAndRecord(
        "linear",
        deliveryId,
        payload.type,
      );

      if (isDuplicate) {
        // Set header for duplicate indication
        res.setHeader?.("X-Duplicate", "true");
        res.status(200).json({
          success: true,
          message: "Duplicate webhook - already processed",
        });
        return;
      }
    }
  }

  // Validate timestamp (prevent replay attacks)
  if (!validateWebhookTimestamp(payload.webhookTimestamp)) {
    logger.warn(
      { timestamp: payload.webhookTimestamp },
      "Webhook timestamp too old",
    );
    res.status(400).json({ error: "Stale webhook" });
    return;
  }

  // Log the payload structure for debugging
  logger.info(
    { payload: JSON.stringify(payload).substring(0, 1000) },
    "AgentSession payload received",
  );

  // Extract issue ID for execution tracking
  const issueId = payload.agentSession.issueId;

  // Start execution tracking
  let executionId: string | undefined;
  if (services?.executionTracker && issueId) {
    const startResult = await services.executionTracker.start({
      agentType: "dev-agent",
      issueId,
      workspaceId: services.workspaceId,
    });
    if (startResult.isOk()) {
      executionId = startResult.value;
    } else {
      // Log but don't fail the request - tracking is best-effort
      logger.warn(
        { err: startResult.error, issueId },
        "Failed to start execution tracking",
      );
    }
  }

  try {
    // Handle the AgentSession event
    const result = await handleAgentSessionWebhook(payload, config, logger);

    // Mark execution complete
    if (executionId && services?.executionTracker) {
      const completeResult =
        await services.executionTracker.complete(executionId);
      if (completeResult.isErr()) {
        logger.warn(
          { err: completeResult.error, executionId },
          "Failed to mark execution complete",
        );
      }
    }

    res.status(200).json(result);
  } catch (error) {
    // Mark execution failed
    if (executionId && services?.executionTracker) {
      const lastState = error instanceof Error ? error.message : "unknown";
      const failResult = await services.executionTracker.fail(
        executionId,
        lastState,
      );
      if (failResult.isErr()) {
        logger.warn(
          { err: failResult.error, executionId },
          "Failed to mark execution failed",
        );
      }
    }
    throw error;
  }
}
