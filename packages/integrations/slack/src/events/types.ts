/**
 * Slack Event Type Definitions
 *
 * Zod schemas for Slack event payloads with type inference.
 * Supports app_mention, message, and block_actions event types.
 */

import { z } from "zod";

// === BASE EVENT SCHEMA ===

/**
 * Common fields shared by all Slack events
 */
export const BaseEventSchema = z.object({
  /** Unique event identifier for deduplication */
  event_id: z.string(),
  /** Unix timestamp of event */
  event_time: z.number(),
  /** Workspace/team ID */
  team_id: z.string(),
  /** App that received the event */
  api_app_id: z.string().optional(),
});

// === APP MENTION EVENT ===

/**
 * Schema for app_mention events
 * Triggered when the bot is @mentioned in a channel
 */
export const SlackMentionEventSchema = BaseEventSchema.extend({
  type: z.literal("app_mention"),
  /** User who mentioned the bot */
  user: z.string(),
  /** Full message text including the mention */
  text: z.string(),
  /** Message timestamp (used for replies) */
  ts: z.string(),
  /** Channel where the mention occurred */
  channel: z.string(),
  /** Thread timestamp if in a thread */
  thread_ts: z.string().optional(),
});

export type SlackMentionEvent = z.infer<typeof SlackMentionEventSchema>;

// === MESSAGE EVENT ===

/**
 * Schema for message events
 * Triggered for messages in channels the bot is in
 */
export const SlackMessageEventSchema = BaseEventSchema.extend({
  type: z.literal("message"),
  /** Subtype for special message types (e.g., "bot_message", "thread_broadcast") */
  subtype: z.string().optional(),
  /** User who sent the message (not present for bot messages) */
  user: z.string().optional(),
  /** Message text content */
  text: z.string(),
  /** Message timestamp */
  ts: z.string(),
  /** Channel ID */
  channel: z.string(),
  /** Thread timestamp if in a thread */
  thread_ts: z.string().optional(),
  /** Channel type */
  channel_type: z.enum(["channel", "group", "im", "mpim"]).optional(),
});

export type SlackMessageEvent = z.infer<typeof SlackMessageEventSchema>;

// === BLOCK ACTIONS EVENT ===

/**
 * Schema for interactive component actions (buttons, selects, etc.)
 */
export const SlackActionEventSchema = z.object({
  type: z.literal("block_actions"),
  /** User who triggered the action */
  user: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
  /** Channel where the action occurred */
  channel: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
  /** Message containing the interactive component */
  message: z
    .object({
      ts: z.string(),
      thread_ts: z.string().optional(),
    })
    .optional(),
  /** List of triggered actions */
  actions: z.array(
    z.object({
      type: z.string(),
      action_id: z.string(),
      block_id: z.string().optional(),
      value: z.string().optional(),
    }),
  ),
  /** URL for responding to the action */
  response_url: z.string().optional(),
  /** ID for opening modals */
  trigger_id: z.string().optional(),
  /** Workspace/team ID (different location than Events API) */
  team: z
    .object({
      id: z.string(),
    })
    .optional(),
});

export type SlackActionEvent = z.infer<typeof SlackActionEventSchema>;

// === UNION SCHEMA ===

/**
 * Union of all supported Slack event types
 * Uses discriminated union on "type" field
 */
export const SlackEventSchema = z.discriminatedUnion("type", [
  SlackMentionEventSchema,
  SlackMessageEventSchema,
  SlackActionEventSchema,
]);

export type SlackEvent = z.infer<typeof SlackEventSchema>;

// === NORMALIZED PAYLOAD ===

/**
 * Action data extracted from block_actions events
 */
export interface NormalizedAction {
  actionId: string;
  value?: string;
}

/**
 * Normalized event payload for consumers
 *
 * Provides a consistent interface across event types,
 * while preserving the raw event for full access.
 */
export interface SlackEventPayload {
  /** Unique event identifier for deduplication */
  eventId: string;
  /** Event type (app_mention, message, block_actions) */
  eventType: string;
  /** Workspace/team ID */
  teamId: string;
  /** User who triggered the event */
  userId?: string;
  /** Channel where the event occurred */
  channel: string;
  /** Message text content */
  text?: string;
  /** Message/event timestamp */
  ts: string;
  /** Thread timestamp if in a thread */
  threadTs?: string;
  /** Actions from block_actions events */
  actions?: NormalizedAction[];
  /** Original parsed event for full access */
  raw: SlackEvent;
}
