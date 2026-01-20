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
} from "@aesir/common";
import type {
  AgentSessionPayload,
  WebhookPayloadBase,
} from "@aesir/integrations";
import {
  type ApprovalWorkflowInput,
  isAgentSessionEvent,
  parseWebhookPayload,
  startApprovalWorkflow,
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "@aesir/integrations";

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
}

/**
 * Express-style request handler for Linear AgentSession webhooks
 *
 * @param req - HTTP request with raw body string
 * @param res - HTTP response object
 * @param config - Workflow configuration
 * @param webhookSecret - Linear webhook signing secret
 */
export async function linearWebhookHandler(
  req: WebhookRequest,
  res: WebhookResponse,
  config: LinearWebhookConfig,
  webhookSecret: string,
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

  // Parse payload
  const payload = parseWebhookPayload<WebhookPayloadBase>(req.rawBody);

  // Validate timestamp (prevent replay attacks)
  if (!validateWebhookTimestamp(payload.webhookTimestamp)) {
    logger.warn(
      { timestamp: payload.webhookTimestamp },
      "Webhook timestamp too old",
    );
    res.status(400).json({ error: "Stale webhook" });
    return;
  }

  // Only handle AgentSession events
  if (!isAgentSessionEvent(payload)) {
    logger.info(
      { type: payload.type },
      `Ignoring webhook type: ${payload.type}`,
    );
    res.status(200).json({ action: "ignored", reason: "not_agent_session" });
    return;
  }

  // Log the payload structure for debugging
  logger.info(
    { payload: JSON.stringify(payload).substring(0, 1000) },
    "AgentSession payload received",
  );

  // Handle the AgentSession event
  const result = await handleAgentSessionWebhook(payload, config, logger);
  res.status(200).json(result);
}
