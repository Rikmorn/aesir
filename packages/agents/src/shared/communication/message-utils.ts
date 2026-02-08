/**
 * Message Utilities
 *
 * Helper functions for enriching agent messages with communication metadata.
 * Used by the conversation executor to inject reply context into the agent's
 * initial message so it knows where to send responses.
 */

import type { ReplyContext } from "./types.js";

/**
 * Append a <reply_context> XML tag to a message string.
 *
 * When replyContext is present, appends a structured XML tag containing the
 * serialized ReplyContext so the agent can determine which channel to reply to.
 * When replyContext is falsy (undefined or null), returns the message unchanged.
 *
 * @param message - The original message text
 * @param replyContext - Optional reply context to append
 * @returns The message, optionally with appended reply_context tag
 */
export function appendReplyContextTag(
  message: string,
  replyContext: ReplyContext | undefined | null,
): string {
  if (!replyContext) {
    return message;
  }

  return `${message}\n\n<reply_context>${JSON.stringify(replyContext)}</reply_context>`;
}
