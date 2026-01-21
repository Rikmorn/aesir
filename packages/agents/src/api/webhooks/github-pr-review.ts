/**
 * GitHub PR Review Webhook Handler
 *
 * Handles pull_request_review events from GitHub webhooks.
 * Translates PR review actions into Temporal workflow signals.
 */

import * as crypto from "node:crypto";

import {
  createChildLogger,
  createPinoLogger,
  generateCorrelationId,
  type PinoLogger,
  ValidationError,
} from "@aesir/common";
import {
  sendApprovalSignal,
  sendChangesRequestedSignal,
} from "@aesir/integrations";

import { type PRReviewPayload, parsePRReviewPayload } from "./schemas/index.js";

const baseLogger: PinoLogger = createPinoLogger({
  component: "agents:webhooks:github-pr-review",
});

/**
 * GitHub pull_request_review event payload (relevant fields)
 * @deprecated Use PRReviewPayload from ./schemas/index.js instead
 */
export interface PRReviewEvent {
  action: "submitted" | "edited" | "dismissed";
  review: {
    id: number;
    user: {
      login: string;
    };
    body: string | null;
    state: "approved" | "changes_requested" | "commented" | "dismissed";
  };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
}

/**
 * Verify GitHub webhook signature
 *
 * Uses HMAC SHA-256 to verify the webhook payload was sent by GitHub.
 *
 * @param payload - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - Webhook secret configured in GitHub
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    // Buffer lengths don't match
    return false;
  }
}

/**
 * Extract task ID from PR body or title
 *
 * Convention: PRs created by the dev agent include the Linear task ID
 * in a consistent format, e.g., "Task: ABC-123" or "[ABC-123]"
 *
 * @param pr - Pull request data with title and body
 * @returns Task ID if found, null otherwise
 */
export function extractTaskId(pr: {
  title: string;
  body: string | null | undefined;
}): string | null {
  // Look for Linear task ID pattern (e.g., ABC-123, PROJ-42)
  const patterns = [
    /Task:\s*([A-Z]+-\d+)/i, // "Task: ABC-123"
    /\[([A-Z]+-\d+)\]/, // "[ABC-123]"
    /Linear:\s*([A-Z]+-\d+)/i, // "Linear: ABC-123"
  ];

  const textToSearch = `${pr.title} ${pr.body ?? ""}`;

  for (const pattern of patterns) {
    const match = textToSearch.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Generate workflow ID from task ID
 *
 * Convention: approval-{taskId}
 *
 * @param taskId - Linear task ID
 * @returns Workflow ID for the approval workflow
 */
export function getWorkflowId(taskId: string): string {
  return `approval-${taskId}`;
}

/**
 * Result of handling a PR review event
 */
export interface HandlePRReviewResult {
  /** What action was taken */
  action: "approved" | "changes_requested" | "ignored" | "no_task_id" | "error";
  /** Workflow ID if a signal was sent */
  workflowId?: string;
  /** Error message if action is 'error' */
  error?: string;
}

/**
 * Handle GitHub pull_request_review webhook event
 *
 * Maps PR review states to Temporal signals:
 * - approved -> approvalSignal with approved: true
 * - changes_requested -> changesRequestedSignal
 * - commented -> ignored (no signal)
 * - dismissed -> ignored
 *
 * @param event - Validated GitHub webhook event payload
 * @param logger - Optional request-scoped logger (falls back to base logger)
 * @returns Result indicating what action was taken
 */
export async function handlePRReviewEvent(
  event: PRReviewPayload | PRReviewEvent,
  logger: PinoLogger = baseLogger,
): Promise<HandlePRReviewResult> {
  // Only handle 'submitted' action
  if (event.action !== "submitted") {
    logger.debug(
      { action: event.action },
      `Ignoring PR review action: ${event.action}`,
    );
    return { action: "ignored" };
  }

  const reviewState = event.review.state;
  const reviewer = event.review.user.login;
  const prNumber = event.pull_request.number;
  const comment = event.review.body;

  logger.info(
    { prNumber, state: reviewState, reviewer },
    `PR #${prNumber} review: ${reviewState} by ${reviewer}`,
  );

  // Only process approved or changes_requested
  if (reviewState !== "approved" && reviewState !== "changes_requested") {
    logger.debug(
      { state: reviewState },
      `Ignoring PR review state: ${reviewState}`,
    );
    return { action: "ignored" };
  }

  // Extract task ID to find the workflow
  const taskId = extractTaskId(event.pull_request);

  if (!taskId) {
    logger.warn(
      { prNumber, title: event.pull_request.title },
      "Could not extract task ID from PR",
    );
    return { action: "no_task_id" };
  }

  const workflowId = getWorkflowId(taskId);

  try {
    if (reviewState === "approved") {
      await sendApprovalSignal(workflowId, {
        approved: true,
        reviewer,
        ...(comment != null && { comment }),
      });

      logger.info(
        { prNumber, workflowId, reviewer },
        `Approval signal sent for PR #${prNumber}`,
      );

      return { action: "approved", workflowId };
    } else {
      // changes_requested
      await sendChangesRequestedSignal(workflowId, {
        reviewer,
        feedback: comment ?? "Changes requested (no details provided)",
      });

      logger.info(
        { prNumber, workflowId, reviewer },
        `Changes-requested signal sent for PR #${prNumber}`,
      );

      return { action: "changes_requested", workflowId };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      { prNumber, workflowId, err: error },
      `Failed to send signal for PR #${prNumber}: ${errorMessage}`,
    );

    // Return error state instead of throwing
    return { action: "error", workflowId, error: errorMessage };
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
 * Express-style request handler for GitHub PR review webhook
 *
 * This is the HTTP endpoint handler. Wire this up to your router.
 *
 * @param req - HTTP request with raw body string
 * @param res - HTTP response object
 */
export async function prReviewWebhookHandler(
  req: WebhookRequest,
  res: WebhookResponse,
): Promise<void> {
  // Generate correlation ID for this request
  const correlationId = generateCorrelationId("req");
  const logger = createChildLogger(baseLogger, { correlationId });

  const signature = req.headers["x-hub-signature-256"];
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  // Verify signature if secret is configured
  if (webhookSecret && signature) {
    if (!verifyWebhookSignature(req.rawBody, signature, webhookSecret)) {
      logger.warn({}, "Invalid webhook signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  logger.info({}, "Processing GitHub PR review webhook");

  // Validate payload with Zod schema
  const parseResult = parsePRReviewPayload(req.rawBody);

  if (!parseResult.success) {
    const validationError = new ValidationError(
      "AGT_WEBHOOK_VALIDATION",
      "Invalid GitHub webhook payload",
      {
        validationErrors: parseResult.error.flatten(),
        metadata: { webhookType: "github-pr-review" },
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

  const result = await handlePRReviewEvent(parseResult.data, logger);
  res.status(200).json(result);
}
