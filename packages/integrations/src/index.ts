/**
 * @aesir/integrations
 *
 * Shared integration services. Individual integrations (Linear, GitHub, Slack)
 * are in their own packages: @aesir/integration-linear, @aesir/integration-github,
 * @aesir/integration-slack.
 */

// === Error Types ===
export type {
  CredentialErrorCode,
  GitHubErrorCode,
  IntegrationServiceErrorCode,
  LinearErrorCode,
  SlackErrorCode,
} from "./errors/index.js";
export {
  CredentialError,
  GitHubError,
  IntegrationServiceError,
  LinearError,
  SlackError,
} from "./errors/index.js";

// === Services ===
export type {
  CheckAndRecordResult,
  WebhookIdempotencyOptions,
  WebhookIdempotencyService,
  WebhookProvider,
} from "./services/index.js";
export {
  createWebhookIdempotencyService,
  WEBHOOK_DELIVERY_HEADERS,
} from "./services/index.js";
