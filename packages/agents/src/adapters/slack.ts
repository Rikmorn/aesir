/**
 * Slack Adapter
 *
 * Transforms Slack NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - block_actions.approved -> "approval" (fast-path signal)
 * - block_actions.rejected -> "approval" (fast-path signal)
 * - block_actions.escalation_retry -> "escalation_resolved" (fast-path signal)
 * - block_actions.escalation_abort -> "escalation_resolved" (fast-path signal)
 * - app_mention.created -> "slack.app_mention.created" (start trigger, preserves original type)
 *
 * Returns null for:
 * - message.created (thread replies) -> slow-path LLM
 * - Any unrecognized Slack event type
 */

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Adapt a Slack NormalizedEvent into a domain-language IncomingEvent.
 * Returns null if the event type is not recognized by this adapter.
 */
export function adaptSlackEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "slack") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "slack.block_actions.approved": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "approval",
        data: { approved: true, source: "slack" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Plan approved via Slack button.",
      };
    }

    case "slack.block_actions.rejected": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "approval",
        data: {
          approved: false,
          feedback: "Rejected via Slack button",
          source: "slack",
        },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message:
          "Plan rejected via Slack button. Feedback: Rejected via Slack button",
      };
    }

    case "slack.block_actions.escalation_retry": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "escalation_resolved",
        data: { action: "retry" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Escalation resolved: retry.",
      };
    }

    case "slack.block_actions.escalation_abort": {
      const taskId = payload.taskIdentifier as string;
      return {
        type: "escalation_resolved",
        data: { action: "abort" },
        source: "slack:webhook",
        correlationKey: taskId,
        deduplicationId: event.correlationId,
        message: "Escalation resolved: abort.",
      };
    }

    case "slack.app_mention.created": {
      const threadTs = (payload.threadTs as string) || (payload.ts as string);
      return {
        type: "slack.app_mention.created",
        data: {
          threadTs,
          channelId: payload.channel,
          initialMessage: payload.text,
          userId: payload.user,
          slackTeamId: payload.teamId,
        },
        source: "slack:webhook",
        correlationKey: threadTs,
        deduplicationId: event.correlationId,
        message: payload.text as string,
      };
    }

    // slack.message.created (thread replies) -> return null for slow-path
    default:
      return null;
  }
}
