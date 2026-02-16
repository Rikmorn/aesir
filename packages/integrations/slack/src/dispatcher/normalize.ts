/**
 * Slack Event Normalization
 *
 * Converts Slack event payloads to NormalizedEvent format.
 */

import { createId, type NormalizedEvent } from "@aesir/types";
import type { SlackEventPayload } from "../events/types.js";

/**
 * Extract timestamp from Slack event payload
 *
 * Tries to get event_time from raw event, falls back to current time.
 *
 * @param payload - Validated Slack event payload
 * @returns ISO 8601 timestamp string
 */
function extractTimestamp(payload: SlackEventPayload): string {
  // Raw event contains event_time for Events API events
  const rawEvent = payload.raw;
  if ("event_time" in rawEvent && typeof rawEvent.event_time === "number") {
    return new Date(rawEvent.event_time * 1000).toISOString();
  }

  // Fallback to current time for block_actions or missing event_time
  return new Date().toISOString();
}

/**
 * Normalize Slack message event to NormalizedEvent
 *
 * @param payload - Validated Slack event payload
 * @returns Normalized event ready for dispatch
 */
export function normalizeMessageEvent(
  payload: SlackEventPayload,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: "slack.message.created",
    source: "slack",
    timestamp: extractTimestamp(payload),
    correlationId: payload.eventId || createId.event(),
    payload: {
      eventType: payload.eventType,
      channel: payload.channel,
      user: payload.userId,
      text: payload.text,
      threadTs: payload.threadTs,
      ts: payload.ts,
      teamId: payload.teamId,
      // App ID for echo detection (identifies which Slack app sent the event)
      ...("api_app_id" in payload.raw &&
        payload.raw.api_app_id && { apiAppId: payload.raw.api_app_id }),
    },
  };
}

/**
 * Normalize Slack app_mention event to NormalizedEvent
 *
 * @param payload - Validated Slack event payload
 * @returns Normalized event ready for dispatch
 */
export function normalizeAppMentionEvent(
  payload: SlackEventPayload,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: "slack.app_mention.created",
    source: "slack",
    timestamp: extractTimestamp(payload),
    correlationId: payload.eventId || createId.event(),
    payload: {
      eventType: payload.eventType,
      channel: payload.channel,
      user: payload.userId,
      text: payload.text,
      threadTs: payload.threadTs,
      ts: payload.ts,
      teamId: payload.teamId,
      // App ID for echo detection (identifies which Slack app sent the event)
      ...("api_app_id" in payload.raw &&
        payload.raw.api_app_id && { apiAppId: payload.raw.api_app_id }),
    },
  };
}

/**
 * Normalize any Slack event based on its type
 *
 * @param payload - Validated Slack event payload
 * @returns Normalized event ready for dispatch, or null if event type not supported
 */
export function normalizeSlackEvent(
  payload: SlackEventPayload,
): NormalizedEvent | null {
  switch (payload.eventType) {
    case "message":
      return normalizeMessageEvent(payload);
    case "app_mention":
      return normalizeAppMentionEvent(payload);
    default:
      return null;
  }
}
