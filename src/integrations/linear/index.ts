/**
 * Linear Integration Module
 *
 * Provides Linear SDK client factory with OAuth token management,
 * webhook signature verification, and agent activity emitters.
 *
 * @example
 * ```typescript
 * import {
 *   createLinearClient,
 *   verifyWebhookSignature,
 *   parseWebhookPayload,
 *   isAgentSessionEvent,
 *   emitThought,
 * } from './integrations/linear';
 *
 * // Verify webhook
 * if (verifyWebhookSignature(signature, rawBody, secret)) {
 *   const payload = parseWebhookPayload(rawBody);
 *   if (isAgentSessionEvent(payload)) {
 *     const client = await createLinearClient(config);
 *     await emitThought(client, payload.data.id, 'Processing...');
 *   }
 * }
 * ```
 */

// Types
export type {
  LinearConfig,
  WebhookPayloadBase,
  WebhookPayload,
  AgentSessionPayload,
  AgentActivityType,
  ThoughtActivityContent,
  ActionActivityContent,
  ResponseActivityContent,
  ErrorActivityContent,
  ElicitationActivityContent,
  AgentActivityContent,
  IssueStatus,
  AgentPlanItem,
} from "./types.js";

// Client factory and helpers
export {
  createLinearClient,
  getLinearClient,
  refreshOAuthToken,
  readIssue,
  updateIssueStatus,
} from "./client.js";

// Webhook signature verification and payload parsing
export {
  verifyWebhookSignature,
  validateWebhookTimestamp,
  parseWebhookPayload,
  isAgentSessionEvent,
  isIssueEvent,
} from "./webhooks.js";

// Agent activity emitters
export {
  emitThought,
  emitAction,
  emitResponse,
  emitError,
  emitElicitation,
  updateSessionPlan,
} from "./activities.js";
