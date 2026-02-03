/**
 * Adapter Types
 *
 * Domain-language event types produced by adapters from NormalizedEvent objects.
 * The IncomingEvent type is the unified shape that the EventRouter (Plan 02) consumes.
 *
 * Key distinction:
 * - Start events preserve their original dotted type (e.g., "slack.app_mention.created")
 *   because agent definition triggers match on those types.
 * - Signal events use domain-language types (e.g., "approval", "pr_merged")
 *   because agents' wait_for calls match on those types.
 */

import type { NormalizedEvent } from "@aesir/types";
import { z } from "zod";

// ---- IncomingEvent Schema -------------------------------------------------

/**
 * Zod schema for the domain-language event type that adapters produce
 * and the EventRouter consumes.
 */
export const IncomingEventSchema = z.object({
  /** Domain event type (e.g., "approval", "pr_merged", or original dotted type for starts) */
  type: z.string().min(1),
  /** Event-specific payload data */
  data: z.record(z.unknown()),
  /** Origin of the event (e.g., "slack:webhook", "github:webhook", "linear:webhook") */
  source: z.string().min(1),
  /** Raw correlation key for conversation ID resolution (e.g., issueId, threadTs) */
  correlationKey: z.string().optional(),
  /** Idempotency key for deduplication (webhook delivery ID) */
  deduplicationId: z.string().optional(),
  /** Human-readable description for agent context on resume */
  message: z.string().optional(),
});

/** Validated IncomingEvent type inferred from the Zod schema */
export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

// ---- EventAdapter Type ----------------------------------------------------

/**
 * Adapter function type: transforms a NormalizedEvent into a domain-language
 * IncomingEvent. Returns null if the event is not recognized by this adapter
 * (falls through to slow-path or next adapter).
 */
export type EventAdapter = (event: NormalizedEvent) => IncomingEvent | null;

// ---- Signal Type Map (Reference) -----------------------------------------

/**
 * Canonical signal type mapping.
 *
 * - Adapters produce IncomingEvent.type matching these domain values
 * - Agents use wait_for({ type: ... }) matching these domain values
 * - EventRouter uses these types for signal routing
 */
export const SIGNAL_TYPE_MAP = {
  planApproval: "approval",
  prCompletion: "pr_merged", // Note: also "pr_closed" for closed-without-merge
  prFeedback: "pr_review",
  escalationResolved: "escalation_resolved",
  userReply: "user_reply",
  cancelConversation: "cancel",
} as const;

// ---- Ignore Event Types ---------------------------------------------------

/**
 * Event types that should be explicitly ignored (not routed, not sent to slow-path).
 * These events are handled by integration webhooks directly.
 */
export const IGNORE_EVENT_TYPES = new Set([
  "linear.issue.created",
  "linear.issue.updated",
]);
