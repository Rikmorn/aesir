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

// Agent activity emitters
export {
  emitAction,
  emitElicitation,
  emitError,
  emitResponse,
  emitThought,
  updateSessionPlan,
} from "./activities.js";

// Client factory and helpers
export {
  createLinearClient,
  getLinearClient,
  readIssue,
  refreshOAuthToken,
  updateIssueStatus,
} from "./client.js";
// Issue management
export {
  type CreateIssueParams,
  type CreateIssueResult,
  createIssue,
  type LabelInfo,
  listLabels,
  listTeams,
  type TeamInfo,
} from "./issues.js";
// Token persistence utilities
export {
  createLinearClientFromFile,
  InvalidTokenFileError,
  loadLinearTokens,
  saveLinearTokens,
  TokenFileNotFoundError,
} from "./token-store.js";
// Types
export type {
  ActionActivityContent,
  AgentActivityContent,
  AgentActivityType,
  AgentPlanItem,
  AgentSessionPayload,
  ElicitationActivityContent,
  ErrorActivityContent,
  LinearConfig,
  ResponseActivityContent,
  ThoughtActivityContent,
  WebhookPayload,
  WebhookPayloadBase,
} from "./types.js";
// Re-export IssueStatus from common (shared cross-layer type)
export type { IssueStatus } from "@aesir/common";
// Webhook signature verification and payload parsing
export {
  isAgentSessionEvent,
  isIssueEvent,
  parseWebhookPayload,
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "./webhooks.js";
