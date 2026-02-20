/**
 * Linear Adapter
 *
 * Transforms Linear NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - agent_session.created -> "linear.agent_session.created" (start trigger, preserves original type)
 * - issue.created -> "linear.issue.created" (adapted for IGNORE_EVENT_TYPES matching)
 * - issue.updated -> "linear.issue.updated" (with correlationKey for materialization routing)
 * - comment.created -> "issue_comment" (domain-language)
 * - agent_session.prompted -> "agent_prompt" (domain-language)
 *
 * Returns null for:
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
  const taskId = payload.taskId as string | undefined;

  // Extract actor info for echo suppression (Phase 75)
  // Linear uses actorType: 'OauthClient' or 'application' for bots, 'user' for humans
  const actorType = payload.actorType as string | undefined;
  const actorInfo = actorType
    ? { isBot: actorType === "OauthClient" || actorType === "application" }
    : undefined;

  switch (event.type) {
    case "linear.agent_session.created": {
      const issueId = payload.issueId as string;
      const sessionId = payload.sessionId as string;
      return {
        type: "linear.agent_session.created",
        data: { issueId, sessionId },
        source: "linear:webhook",
        correlationKey: issueId,
        deduplicationId: event.correlationId,
        message: `New agent session created for issue ${issueId}`,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        entityRef: {
          entityType: "linear_issue" as const,
          entityId: issueId,
        },
        replyContext: {
          channel: "linear" as const,
          issueId,
          agentSessionId: sessionId,
        },
      };
    }

    case "linear.issue.created": {
      const issueId = (payload.issueId ?? payload.id) as string | undefined;
      return {
        type: "linear.issue.created",
        data: payload,
        source: "linear:webhook",
        deduplicationId: event.correlationId,
        ...(actorInfo && { actorInfo }),
        ...(issueId && {
          entityRef: {
            entityType: "linear_issue" as const,
            entityId: issueId,
          },
        }),
        // No correlationKey -- this is an ignore event
      };
    }

    case "linear.issue.updated": {
      const issueId = (payload.issueId ?? payload.id) as string | undefined;
      return {
        type: "linear.issue.updated",
        data: payload,
        source: "linear:webhook",
        correlationKey: issueId, // Enables materialization lookup in router
        deduplicationId: event.correlationId,
        ...(actorInfo && { actorInfo }),
        ...(issueId && {
          entityRef: {
            entityType: "linear_issue" as const,
            entityId: issueId,
          },
        }),
      };
    }

    case "linear.comment.created": {
      const issueId = payload.issueId as string;
      return {
        type: "issue_comment",
        data: {
          body: payload.body,
          userId: payload.userId,
          issueId,
        },
        source: "linear:webhook",
        correlationKey: issueId,
        deduplicationId: event.correlationId,
        message: payload.body as string,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        entityRef: {
          entityType: "linear_issue" as const,
          entityId: issueId,
        },
        replyContext: { channel: "linear" as const, issueId },
      };
    }

    case "linear.agent_session.prompted": {
      const issueId = payload.issueId as string;
      const sessionId = payload.sessionId as string;
      return {
        type: "agent_prompt",
        data: {
          issueId,
          sessionId,
          prompt: (payload.prompt ?? payload.body) as string,
        },
        source: "linear:webhook",
        correlationKey: issueId,
        deduplicationId: event.correlationId,
        message: (payload.prompt ?? payload.body) as string,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        entityRef: {
          entityType: "linear_issue" as const,
          entityId: issueId,
        },
        replyContext: {
          channel: "linear" as const,
          issueId,
          agentSessionId: sessionId,
        },
      };
    }

    default:
      return null;
  }
}
