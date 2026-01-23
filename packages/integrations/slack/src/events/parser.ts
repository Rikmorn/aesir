/**
 * Slack Event Parser
 *
 * Zod-based parsing for Slack event payloads with SafeParseReturnType
 * for controlled error handling. Includes normalizer for consistent
 * event payload format.
 */

import type { z } from "zod";
import {
  type NormalizedAction,
  type SlackActionEvent,
  SlackActionEventSchema,
  type SlackEvent,
  type SlackEventPayload,
  SlackEventSchema,
  type SlackMentionEvent,
  SlackMentionEventSchema,
  type SlackMessageEvent,
  SlackMessageEventSchema,
} from "./types.js";

/**
 * Parse an app_mention event payload
 *
 * @param payload - Raw event payload
 * @returns SafeParseReturnType with typed data or ZodError
 */
export function parseMentionEvent(
  payload: unknown,
): z.SafeParseReturnType<unknown, SlackMentionEvent> {
  return SlackMentionEventSchema.safeParse(payload);
}

/**
 * Parse a message event payload
 *
 * @param payload - Raw event payload
 * @returns SafeParseReturnType with typed data or ZodError
 */
export function parseMessageEvent(
  payload: unknown,
): z.SafeParseReturnType<unknown, SlackMessageEvent> {
  return SlackMessageEventSchema.safeParse(payload);
}

/**
 * Parse a block_actions event payload
 *
 * @param payload - Raw event payload
 * @returns SafeParseReturnType with typed data or ZodError
 */
export function parseActionEvent(
  payload: unknown,
): z.SafeParseReturnType<unknown, SlackActionEvent> {
  return SlackActionEventSchema.safeParse(payload);
}

/**
 * Parse any supported Slack event
 *
 * Uses discriminated union on "type" field for validation.
 *
 * @param payload - Raw event payload
 * @returns SafeParseReturnType with typed data or ZodError
 */
export function parseSlackEvent(
  payload: unknown,
): z.SafeParseReturnType<unknown, SlackEvent> {
  return SlackEventSchema.safeParse(payload);
}

/**
 * Extract event_id from a parsed event
 *
 * For Events API events (app_mention, message), the event_id is a direct field.
 * For Interactive events (block_actions), we generate an ID from action context.
 *
 * @param event - Parsed Slack event
 * @returns Unique event identifier
 */
function extractEventId(event: SlackEvent): string {
  if (event.type === "block_actions") {
    // Interactive events don't have event_id - use action context
    // Format: block_actions:<channel>:<message_ts>:<action_ids>
    const actionIds = event.actions.map((a) => a.action_id).join(",");
    const messageTs = event.message?.ts ?? "no_message";
    return `block_actions:${event.channel.id}:${messageTs}:${actionIds}`;
  }

  // Events API events have event_id
  return event.event_id;
}

/**
 * Extract team_id from a parsed event
 *
 * Different event types store team_id in different locations.
 *
 * @param event - Parsed Slack event
 * @returns Team/workspace ID
 */
function extractTeamId(event: SlackEvent): string {
  if (event.type === "block_actions") {
    // Interactive events have team object
    return event.team?.id ?? "unknown";
  }

  // Events API events have team_id directly
  return event.team_id;
}

/**
 * Normalize a parsed Slack event to consistent payload format
 *
 * Converts typed event payloads into a normalized structure for consumers.
 * Always includes the raw event for cases where full access is needed.
 *
 * @param event - Parsed and validated Slack event
 * @returns Normalized SlackEventPayload
 */
export function normalizeEvent(event: SlackEvent): SlackEventPayload {
  const eventId = extractEventId(event);
  const teamId = extractTeamId(event);

  switch (event.type) {
    case "app_mention": {
      // Conditional property assignment for exactOptionalPropertyTypes
      const payload: SlackEventPayload = {
        eventId,
        eventType: "app_mention",
        teamId,
        userId: event.user,
        channel: event.channel,
        text: event.text,
        ts: event.ts,
        raw: event,
      };
      if (event.thread_ts !== undefined) {
        payload.threadTs = event.thread_ts;
      }
      return payload;
    }

    case "message": {
      // Conditional property assignment for exactOptionalPropertyTypes
      const payload: SlackEventPayload = {
        eventId,
        eventType: "message",
        teamId,
        channel: event.channel,
        text: event.text,
        ts: event.ts,
        raw: event,
      };
      if (event.user !== undefined) {
        payload.userId = event.user;
      }
      if (event.thread_ts !== undefined) {
        payload.threadTs = event.thread_ts;
      }
      return payload;
    }

    case "block_actions": {
      // Map actions with conditional value assignment
      const actions: NormalizedAction[] = event.actions.map((action) => {
        const normalized: NormalizedAction = { actionId: action.action_id };
        if (action.value !== undefined) {
          normalized.value = action.value;
        }
        return normalized;
      });

      const payload: SlackEventPayload = {
        eventId,
        eventType: "block_actions",
        teamId,
        userId: event.user.id,
        channel: event.channel.id,
        ts: event.message?.ts ?? "",
        actions,
        raw: event,
      };
      if (event.message?.thread_ts !== undefined) {
        payload.threadTs = event.message.thread_ts;
      }
      return payload;
    }

    default: {
      // TypeScript exhaustiveness check
      const Exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(Exhaustive)}`);
    }
  }
}
