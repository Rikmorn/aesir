/**
 * communication:notify Tool Factory
 *
 * Sends a notification to an explicit channel target via the denormalizer.
 * Unlike reply/ask, notify does not use the conversation's originating channel --
 * it requires an explicit target ReplyContext for broadcasting updates.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { denormalize } from "../../communication/denormalizer.js";
import {
  type CommunicationToolDeps,
  ReplyContextSchema,
} from "../../communication/types.js";
import { McpError } from "../../mcp/errors.js";

const NotifyInputSchema = z.object({
  target: ReplyContextSchema.describe(
    "Explicit channel target to send the notification to",
  ),
  message: z.string().describe("Notification message text"),
  intent: z
    .enum(["reasoning", "action"])
    .optional()
    .describe(
      "Notification intent: 'reasoning' emits a thought activity, 'action' emits an action activity. " +
        "Only affects Linear agent sessions. Defaults to reasoning.",
    ),
});

/**
 * Create a communication:notify tool that sends notifications via the denormalizer.
 *
 * @param deps - Communication dependencies (agentId, correlationId, logger)
 * @returns ToolDefinition compatible with the agent loop
 */
export function createNotifyTool(deps: CommunicationToolDeps): ToolDefinition {
  return {
    name: "communication_notify",
    description:
      "Send a notification to an explicit channel target. Use this when broadcasting " +
      "updates to a channel that is not the conversation's originating channel. " +
      "Requires an explicit target ReplyContext.",
    inputSchema: NotifyInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = NotifyInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      try {
        const notifyIntent =
          parsed.data.intent === "action"
            ? ("notify_action" as const)
            : ("notify_reasoning" as const);

        const result = await denormalize(
          {
            replyContext: parsed.data.target,
            text: parsed.data.message,
            intent: notifyIntent,
          },
          deps,
        );
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: `communication_notify error: ${error.message}`,
            isError: true,
          };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: `communication_notify error: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
