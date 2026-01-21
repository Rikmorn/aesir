/**
 * Linear Webhook Handling Module
 *
 * Complete webhook processing including signature verification,
 * Zod-based payload validation, and type guards for event detection.
 */

// === PARSER ===
export {
  AgentSessionSchema,
  isAgentSessionEvent,
  isIssueEvent,
  parseAgentSessionPayload,
  parseWebhookPayload,
} from "./parser.js";

// === SIGNATURE ===
export {
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "./signature.js";
// === TYPES ===
export type {
  ActionActivityContent,
  AgentActivityContent,
  AgentActivityType,
  AgentPlanItem,
  AgentSessionPayload,
  ElicitationActivityContent,
  ErrorActivityContent,
  ResponseActivityContent,
  ThoughtActivityContent,
  WebhookPayload,
  WebhookPayloadBase,
} from "./types.js";
