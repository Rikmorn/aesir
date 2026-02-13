import { z } from "zod";

/**
 * Event source - which integration produced this event
 */
export const EventSourceSchema = z.enum([
  "linear",
  "github",
  "slack",
  "testing",
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

/**
 * Normalized event schema for cross-integration event dispatch
 *
 * Event types use dotted notation: {source}.{resource}.{action}
 * Examples:
 * - linear.agent_session.created
 * - linear.agent_session.prompted
 * - github.pull_request.review_submitted
 * - github.pull_request.merged
 * - slack.message.created
 * - slack.app_mention.created
 */
export const NormalizedEventSchema = z.object({
  /** Unique event ID (evt_<nanoid>) */
  id: z.string().startsWith("evt_"),
  /** Event type in dotted notation: {source}.{resource}.{action} */
  type: z.string().regex(/^(linear|github|slack|testing)\.[a-z_]+\.[a-z_]+$/),
  /** Source integration */
  source: EventSourceSchema,
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /** Correlation ID for log tracing (from webhook delivery ID) */
  correlationId: z.string(),
  /** Source-specific event payload */
  payload: z.unknown(),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
