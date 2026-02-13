/**
 * Testing Adapter
 *
 * Transforms testing NormalizedEvents into IncomingEvents.
 * Used for lightweight test agents that exercise specific patterns
 * (delegation, handoff, etc.) without requiring real integration events.
 *
 * Extracts correlationKey from payload.correlationKey (required).
 */

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

export function adaptTestingEvent(
  event: NormalizedEvent,
): IncomingEvent | null {
  if (event.source !== "testing") return null;

  const payload = (event.payload as Record<string, unknown>) ?? {};
  const correlationKey = payload.correlationKey as string | undefined;

  if (!correlationKey) return null;

  return {
    type: event.type,
    data: payload,
    source: "testing",
    correlationKey,
    deduplicationId: event.correlationId,
    message: (payload.message as string) ?? undefined,
  };
}
