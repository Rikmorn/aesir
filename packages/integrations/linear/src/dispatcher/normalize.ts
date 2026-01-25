/**
 * Linear Event Normalization
 *
 * Converts Linear webhook payloads to NormalizedEvent format.
 */

import { createId, type NormalizedEvent } from "@aesir/common";
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
