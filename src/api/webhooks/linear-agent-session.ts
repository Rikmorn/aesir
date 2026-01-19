/**
 * Linear AgentSession Webhook Handler
 *
 * Handles AgentSession webhooks from Linear to trigger the Dev Agent workflow.
 * When a task is delegated to the Dev Agent, Linear sends an AgentSession webhook
 * which this handler uses to start the prApprovalWorkflow in Temporal.
 */

import { createLogger } from "../../logging/logger.js";
import {
  verifyWebhookSignature,
  validateWebhookTimestamp,
  parseWebhookPayload,
  isAgentSessionEvent,
} from "../../integrations/linear/webhooks.js";
import type {
  AgentSessionPayload,
  WebhookPayloadBase,
} from "../../integrations/linear/types.js";
import {
  startApprovalWorkflow,
  type ApprovalWorkflowInput,
} from "../../temporal/client.js";

const logger = createLogger({
  defaultContext: { module: "linear-agent-session-webhook" },
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
  completionStatus: "Todo" | "In Progress" | "Done" | "Canceled";
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
 * @returns Result indicating what action was taken
 */
export async function handleAgentSessionWebhook(
  payload: AgentSessionPayload,
  config: LinearWebhookConfig
): Promise<HandleAgentSessionResult> {
  const { action, data } = payload;
  const taskId = data.issueId;

  logger.info("linear_agent_session_received", {
    message: `AgentSession ${action} for issue ${taskId}`,
    context: { action, taskId, sessionId: data.id },
  });

  // Only handle 'created' action (new delegation)
  // 'prompted' is for follow-up messages which we don't handle yet
  if (action !== "created") {
    logger.debug("linear_agent_session_ignored", {
      message: `Ignoring AgentSession action: ${action}`,
      context: { action, taskId },
    });
    return { action: "ignored", taskId };
  }

  // Generate workflow ID from task ID (same convention as GitHub webhook)
  const workflowId = `approval-${taskId}`;

  try {
    // Build workflow input
    const workflowInput: ApprovalWorkflowInput = {
      taskId,
      owner: config.owner,
      repo: config.repo,
      slackChannel: config.slackChannel,
      completionStatus: config.completionStatus,
    };

    // Start the approval workflow
    await startApprovalWorkflow(workflowId, workflowInput);

    logger.info("linear_agent_session_workflow_started", {
      outcome: "success",
      message: `Started approval workflow for task ${taskId}`,
      context: { taskId, workflowId },
    });

    return { action: "workflow_started", workflowId, taskId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("linear_agent_session_workflow_failed", {
      outcome: "failure",
      message: `Failed to start workflow for task ${taskId}: ${errorMessage}`,
      context: { taskId, workflowId, error: errorMessage },
    });

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
  webhookSecret: string
): Promise<void> {
  const signature = req.headers["linear-signature"];

  // Verify signature
  if (
    !signature ||
    !verifyWebhookSignature(signature, req.rawBody, webhookSecret)
  ) {
    logger.warn("linear_webhook_invalid_signature", {
      message: "Invalid or missing webhook signature",
    });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse payload
  const payload = parseWebhookPayload<WebhookPayloadBase>(req.rawBody);

  // Validate timestamp (prevent replay attacks)
  if (!validateWebhookTimestamp(payload.webhookTimestamp)) {
    logger.warn("linear_webhook_stale_timestamp", {
      message: "Webhook timestamp too old",
      context: { timestamp: payload.webhookTimestamp },
    });
    res.status(400).json({ error: "Stale webhook" });
    return;
  }

  // Only handle AgentSession events
  if (!isAgentSessionEvent(payload)) {
    logger.debug("linear_webhook_not_agent_session", {
      message: `Ignoring webhook type: ${payload.type}`,
      context: { type: payload.type },
    });
    res.status(200).json({ action: "ignored", reason: "not_agent_session" });
    return;
  }

  // Handle the AgentSession event
  const result = await handleAgentSessionWebhook(payload, config);
  res.status(200).json(result);
}
