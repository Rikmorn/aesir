/**
 * Webhook Handlers
 *
 * HTTP handlers for external service webhooks.
 * These translate external events into internal actions.
 */

export {
  handlePRReviewEvent,
  prReviewWebhookHandler,
  verifyWebhookSignature,
  extractTaskId,
  getWorkflowId,
  type PRReviewEvent,
  type HandlePRReviewResult,
  type WebhookRequest,
  type WebhookResponse,
} from "./github-pr-review.js";

export {
  handleAgentSessionWebhook,
  linearWebhookHandler,
  type LinearWebhookConfig,
  type HandleAgentSessionResult,
  type WebhookRequest as LinearWebhookRequest,
  type WebhookResponse as LinearWebhookResponse,
} from "./linear-agent-session.js";
