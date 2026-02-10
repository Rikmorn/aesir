/**
 * communication:reply Tool Factory
 *
 * Sends a message back to the originating channel using the denormalizer.
 * Requires replyContext from the signal that resumed the conversation.
 * Delegates all routing logic to denormalize().
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { denormalize } from "../../communication/denormalizer.js";
import {
  type CommunicationToolDeps,
  ReplyContextSchema,
} from "../../communication/types.js";
import { McpError } from "../../mcp/errors.js";

const ReplyInputSchema = z.object({
  replyContext: ReplyContextSchema.describe(
    "Channel address to reply to (from signal context)",
  ),
  message: z.string().describe("Message text to send as a reply"),
});

/**
 * Create a communication:reply tool that sends messages via the denormalizer.
 *
 * @param deps - Communication dependencies (agentId, correlationId, logger)
 * @returns ToolDefinition compatible with the agent loop
 */
export function createReplyTool(deps: CommunicationToolDeps): ToolDefinition {
  return {
    name: "communication_reply",
    description:
      "Reply to the originating channel. Sends a message back to wherever the current " +
      "conversation was triggered from. Requires replyContext from the signal that " +
      "resumed this conversation.",
    inputSchema: ReplyInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = ReplyInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      try {
        const result = await denormalize(
          {
            replyContext: parsed.data.replyContext,
            text: parsed.data.message,
            intent: "reply",
          },
          deps,
        );
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: `communication_reply error: ${error.message}`,
            isError: true,
          };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: `communication_reply error: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
