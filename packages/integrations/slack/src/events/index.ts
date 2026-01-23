/**
 * Slack Events Module
 *
 * Barrel export for event handling functionality.
 */

// === HANDLER ===
export type { EventHandler, EventHandlerOptions } from "./handler.js";
export { createEventHandler } from "./handler.js";

// === PARSER ===
export {
  normalizeEvent,
  parseActionEvent,
  parseMentionEvent,
  parseMessageEvent,
  parseSlackEvent,
} from "./parser.js";
// === TYPES ===
export type {
  NormalizedAction,
  SlackActionEvent,
  SlackEvent,
  SlackEventPayload,
  SlackMentionEvent,
  SlackMessageEvent,
} from "./types.js";
export {
  BaseEventSchema,
  SlackActionEventSchema,
  SlackEventSchema,
  SlackMentionEventSchema,
  SlackMessageEventSchema,
} from "./types.js";
