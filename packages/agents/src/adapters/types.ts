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
import { ReplyContextSchema } from "../shared/communication/types.js";

// ---- Entity Reference Schema -----------------------------------------------

/**
 * Typed entity reference extracted by adapters from event payloads.
 * Used by the correlation router to look up existing work for an entity.
 */
export const EntityRefSchema = z.object({
  entityType: z.enum(["linear_issue", "github_pr", "slack_thread"]),
  entityId: z.string().min(1),
});

/** Typed entity reference for work correlation lookup */
export type EntityRef = z.infer<typeof EntityRefSchema>;

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
  /** Task ID from correlation lookup (v2.5 task primitive) */
  taskId: z.string().optional(),
  /** Reply context for routing agent responses back to the originating channel */
  replyContext: ReplyContextSchema.optional(),
  /** Actor information for echo suppression (populated by adapters) */
  actorInfo: z
    .object({
      /** Whether the actor is a bot (used by webhook filter Layer 2) */
      isBot: z.boolean(),
      /** Actor identifier for logging/debugging (e.g., bot login, app ID) */
      identifier: z.string().optional(),
    })
    .optional(),
  /** Entity reference for work correlation lookup (populated by adapters when entity is unambiguous) */
  entityRef: EntityRefSchema.optional(),
});

/** Validated IncomingEvent type inferred from the Zod schema */
export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

// ---- Adapter Ignore Sentinel ----------------------------------------------

/**
 * Returned by adapters when an event is explicitly recognized but should be
 * dropped (not routed, not sent to slow-path). Distinct from null, which
 * means "I don't recognize this event, try the next adapter."
 */
export interface AdapterIgnore {
  readonly action: "ignore";
  readonly reason: string;
}

/** Type guard for AdapterIgnore */
export function isAdapterIgnore(
  result: IncomingEvent | AdapterIgnore | null,
): result is AdapterIgnore {
  return result !== null && "action" in result && result.action === "ignore";
}

// ---- EventAdapter Type ----------------------------------------------------

/**
 * Adapter function type: transforms a NormalizedEvent into a domain-language
 * IncomingEvent. Returns:
 * - IncomingEvent: recognized event, route it
 * - AdapterIgnore: recognized event, explicitly drop it
 * - null: unrecognized event, try the next adapter
 */
export type EventAdapter = (
  event: NormalizedEvent,
) => IncomingEvent | AdapterIgnore | null;

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
export const IGNORE_EVENT_TYPES = new Set(["linear.issue.created"]);
