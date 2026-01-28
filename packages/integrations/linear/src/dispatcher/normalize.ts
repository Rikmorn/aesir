/**
 * Linear Event Normalization
 *
 * Converts Linear webhook payloads to NormalizedEvent format.
 */

import { createId, type NormalizedEvent } from "@aesir/types";
import type { CommentPayload } from "../webhooks/parser.js";
import type { AgentSessionPayload } from "../webhooks/types.js";

/**
 * Normalize AgentSession webhook payload to NormalizedEvent
 *
 * @param payload - Validated AgentSession webhook payload
 * @param deliveryId - Linear-Delivery header value (used as correlationId)
 * @returns Normalized event ready for dispatch
 */
export function normalizeAgentSessionEvent(
  payload: AgentSessionPayload,
  deliveryId: string,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: `linear.agent_session.${payload.action}`,
    source: "linear",
    timestamp: new Date(payload.webhookTimestamp).toISOString(),
    correlationId: deliveryId,
    payload: {
      sessionId: payload.agentSession.id,
      issueId: payload.agentSession.issueId,
      status: payload.agentSession.status,
      url: payload.agentSession.url,
      creatorId: payload.agentSession.creator?.id,
    },
  };
}

/**
 * Normalize Comment webhook payload to NormalizedEvent
 *
 * Used for approval intent classification - when users respond to plans
 * via Linear comments (e.g., "looks good", "approved", "hold on").
 *
 * @param payload - Validated Comment webhook payload
 * @param deliveryId - Linear-Delivery header value (used as correlationId)
 * @returns Normalized event ready for dispatch to dev-agent
 */
export function normalizeCommentCreatedEvent(
  payload: CommentPayload,
  deliveryId: string,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: "linear.comment.created",
    source: "linear",
    timestamp: new Date(payload.webhookTimestamp).toISOString(),
    correlationId: deliveryId,
    payload: {
      commentId: payload.data.id,
      commentBody: payload.data.body,
      issueId: payload.data.issueId,
      userId: payload.data.userId,
      actorName: payload.actor?.name ?? "Unknown",
      actorEmail: payload.actor?.email,
      createdAt: payload.data.createdAt,
    },
  };
}
