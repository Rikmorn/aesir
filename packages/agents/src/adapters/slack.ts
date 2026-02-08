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
 * - message.created (with threadTs) -> "thread_reply" (domain-language)
 *
 * Returns AdapterIgnore for:
 * - message.created without threadTs (top-level channel messages; @mentions handled by app_mention)
 *
 * Returns null for:
 * - Any unrecognized Slack event type
 */

import type { NormalizedEvent } from "@aesir/types";
import type { AdapterIgnore, IncomingEvent } from "./types.js";

/**
 * Adapt a Slack NormalizedEvent into a domain-language IncomingEvent.
 * Returns AdapterIgnore for known events that should be dropped.
 * Returns null if the event type is not recognized by this adapter.
 */
export function adaptSlackEvent(
  event: NormalizedEvent,
): IncomingEvent | AdapterIgnore | null {
  if (event.source !== "slack") return null;

  const payload = event.payload as Record<string, unknown>;
  const correlatedTaskId = payload.taskId as string | undefined;

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
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
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
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
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
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
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
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
      };
    }

    case "slack.app_mention.created": {
      const threadTs = (payload.threadTs as string) || (payload.ts as string);
      const teamId = payload.teamId as string | undefined;
      const channelId = payload.channel as string | undefined;
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
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
        ...(teamId && channelId && { replyContext: { channel: "slack" as const, teamId, channelId, threadTs } }),
      };
    }

    case "slack.message.created": {
      const threadTs = payload.threadTs as string | undefined;

      // Top-level channel messages (no threadTs) are explicitly ignored.
      // @mentions are already handled by app_mention.created (fast-path),
      // and non-@mention channel messages have no routing target.
      // Only thread replies (with threadTs) need slow-path routing.
      if (!threadTs) {
        return {
          action: "ignore" as const,
          reason:
            "Top-level message without threadTs; @mentions handled by app_mention",
        };
      }

      const teamId = payload.teamId as string | undefined;
      const channelId = payload.channel as string | undefined;
      return {
        type: "thread_reply",
        data: {
          text: payload.text,
          userId: payload.user,
          channelId: payload.channel,
          threadTs,
        },
        source: "slack:webhook",
        correlationKey: threadTs,
        deduplicationId: event.correlationId,
        message: payload.text as string,
        ...(correlatedTaskId && { taskId: correlatedTaskId }),
        ...(teamId && channelId && { replyContext: { channel: "slack" as const, teamId, channelId, threadTs } }),
      };
    }

    default:
      return null;
  }
}
