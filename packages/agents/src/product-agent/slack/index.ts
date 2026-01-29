/**
 * Slack Handlers for Product Agent
 *
 * Event handlers for app_mention and direct message events.
 */

export {
  handleAppMention,
  handleDirectMessage,
  registerHandlers,
  type ThreadHandlerOptions,
} from "./thread-handlers.js";
