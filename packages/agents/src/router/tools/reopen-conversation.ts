/**
 * Reopen Conversation Tool
 *
 * Router tool that reopens a completed or failed conversation via
 * ConversationExecutor. Used when a new event arrives for a conversation
 * that has already finished (e.g., same-thread Slack follow-up).
 *
 * The executor appends a <world_state> message with the reason,
 * resets execution limits, and transitions to queued.
 */

import { z } from "zod";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import type { EventRouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const ReopenConversationInputSchema = z.object({
  conversationId: z
    .string()
    .describe("Conversation ID to reopen (e.g., 'product-agent-{threadTs}')"),
  reason: z
    .string()
    .describe(
      "Context for why the conversation is being reopened (e.g., user's follow-up message text). This is injected into the conversation as a <world_state> block so the agent has context.",
    ),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the reopen_conversation tool definition.
 *
 * Calls ConversationExecutor.reopen() to transition a completed/failed
 * conversation back to queued with a world-state context message.
 *
 * Use this instead of signal_conversation when the target conversation
 * is in a terminal state (completed or failed).
 *
 * @param deps - Event router dependencies (needs executor)
 * @returns ToolDefinition for the agent loop
 */
export function createReopenConversationTool(
  deps: EventRouterDeps,
): ToolDefinition {
  return {
    name: "reopen_conversation",
    description:
      "Reopen a completed or failed conversation with new context. Use when a conversation exists but is in a terminal state (completed/failed) and a new event requires resuming it. The reason text is injected as context for the agent.",
    inputSchema: ReopenConversationInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = ReopenConversationInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { conversationId, reason } = parsed.data;

      try {
        const result = await deps.executor.reopen(conversationId, reason);

        deps.logger.info(
          { conversationId, action: result.action },
          `reopen_conversation: conversation ${result.action}`,
        );

        if (result.action === "rejected") {
          return {
            content: `Cannot reopen conversation "${conversationId}": ${result.error ?? "unknown reason"}`,
            isError: true,
          };
        }

        return {
          content: JSON.stringify({
            reopened: true,
            conversationId,
          }),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error, conversationId },
          "reopen_conversation: failed to reopen conversation",
        );
        return {
          content: `Failed to reopen conversation: ${errorMessage}`,
          isError: true,
        };
      }
    },
  };
}
