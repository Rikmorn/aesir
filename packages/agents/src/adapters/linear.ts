/**
 * Linear Adapter
 *
 * Transforms Linear NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - agent_session.created -> "linear.agent_session.created" (start trigger, preserves original type)
 * - issue.created -> "linear.issue.created" (adapted for IGNORE_EVENT_TYPES matching)
 * - issue.updated -> "linear.issue.updated" (adapted for IGNORE_EVENT_TYPES matching)
 *
 * Returns null for:
 * - comment.created -> slow-path LLM (comments need intent classification)
 * - Any unrecognized Linear event type
 */

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Adapt a Linear NormalizedEvent into a domain-language IncomingEvent.
 * Returns null if the event type is not recognized by this adapter.
 */
export function adaptLinearEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "linear") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "linear.agent_session.created": {
      const issueId = payload.issueId as string;
      return {
        type: "linear.agent_session.created",
        data: { issueId },
        source: "linear:webhook",
        correlationKey: issueId,
        deduplicationId: event.correlationId,
        message: `New agent session created for issue ${issueId}`,
      };
    }

    case "linear.issue.created":
      return {
        type: "linear.issue.created",
        data: payload,
        source: "linear:webhook",
        deduplicationId: event.correlationId,
        // No correlationKey -- this is an ignore event
      };

    case "linear.issue.updated":
      return {
        type: "linear.issue.updated",
        data: payload,
        source: "linear:webhook",
        deduplicationId: event.correlationId,
        // No correlationKey -- this is an ignore event
      };

    // linear.comment.created -> return null for slow-path
    default:
      return null;
  }
}
