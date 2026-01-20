/**
 * Slack Assistant Module
 *
 * Exports event handlers for the Product Agent's Slack integration.
 * Handles app_mention and direct message events, routing them
 * through the requirement gathering conversation flow.
 */

export {
  handleAppMention,
  handleDirectMessage,
  registerHandlers,
  type ThreadHandlerOptions,
} from "./thread-handlers.js";
