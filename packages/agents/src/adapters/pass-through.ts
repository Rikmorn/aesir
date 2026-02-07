/**
 * Pass-Through Adapter
 *
 * Fallback adapter that wraps any NormalizedEvent as a generic IncomingEvent.
 * Used after all source-specific adapters return null, ensuring the adapter
 * pipeline NEVER produces null -- every event gets a domain-language wrapper.
 *
 * The pass-through adapter intentionally omits correlationKey so unrecognized
 * events always route to the slow-path LLM for classification.
 */

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Wrap any NormalizedEvent as a generic IncomingEvent.
 * Always succeeds -- this is the end-of-pipeline fallback.
 *
 * @param event - The NormalizedEvent that no source-specific adapter matched
 * @returns IncomingEvent with the original event type and payload
 */
export function adaptPassThrough(event: NormalizedEvent): IncomingEvent {
  const payload = (event.payload as Record<string, unknown>) ?? {};
  return {
    type: event.type,
    data: payload,
    source: `${event.source}:webhook`,
    // No correlationKey -- always goes to slow_path
    deduplicationId: event.correlationId,
    ...(typeof payload.taskId === "string" && { taskId: payload.taskId }),
  };
}
