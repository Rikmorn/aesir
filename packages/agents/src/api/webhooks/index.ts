/**
 * Webhook Handlers
 *
 * HTTP handlers for external service webhooks.
 * These translate external events into internal actions.
 */

export {
  extractTaskId,
  getWorkflowId,
  type HandlePRReviewResult,
  handlePRReviewEvent,
  type PRReviewEvent,
  prReviewWebhookHandler,
  type WebhookRequest,
  type WebhookResponse,
} from "./github-pr-review.js";

export {
  type HandleAgentSessionResult,
  handleAgentSessionWebhook,
  type LinearWebhookConfig,
  linearWebhookHandler,
  type WebhookRequest as LinearWebhookRequest,
  type WebhookResponse as LinearWebhookResponse,
} from "./linear-agent-session.js";
