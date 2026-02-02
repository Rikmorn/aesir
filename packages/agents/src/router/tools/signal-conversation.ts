/**
 * Signal Conversation Tool
 *
 * Router tool that sends a signal to an existing conversation via
 * ConversationExecutor. Adapted from signal-workflow.ts for v2.3 --
 * replaces Temporal signal definitions with domain-language signal types.
 *
 * Uses the v2.3 Signal schema directly (type + data + message) instead
 * of mapping through Temporal signal definitions and SIGNAL_MAP.
 *
 * Both this file and signal-workflow.ts coexist until Phase 47 cleanup.
 */

import { z } from "zod";
import type { Signal } from "../../framework/types.js";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import type { EventRouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const SignalConversationInputSchema = z.object({
  conversationId: z
    .string()
    .describe(
      "Conversation ID to signal (e.g., 'dev-agent-{issueId}' or 'product-agent-{threadTs}')",
    ),
  signalType: z
    .enum([
      "approval",
      "pr_review",
      "escalation_resolved",
      "pr_merged",
      "pr_closed",
      "user_reply",
      "cancel",
    ])
    .describe("Signal type to send (domain-language)"),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Signal data payload (varies by signal type)"),
  message: z
    .string()
    .optional()
    .describe(
      "Human-readable message included when resuming the agent (e.g., feedback text, reply content)",
    ),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the signal_conversation tool definition.
 *
 * Builds a Signal object from the LLM's input and calls
 * ConversationExecutor.signal(). The executor handles state-based
 * dispatch (resume, queue, reject, deduplicate).
 *
 * Signal types use domain language directly:
 * - approval (replaces planApproval)
 * - pr_review (replaces prFeedback)
 * - escalation_resolved (replaces escalationResolved)
 * - pr_merged / pr_closed (replaces prCompletion)
 * - user_reply (replaces userReply)
 * - cancel (replaces cancelConversation)
 *
 * @param deps - Event router dependencies (needs executor)
 * @returns ToolDefinition for the agent loop
 */
export function createSignalConversationTool(
  deps: EventRouterDeps,
): ToolDefinition {
  return {
    name: "signal_conversation",
    description:
      "Send a signal to an existing conversation. Use approval for plan approvals/rejections, pr_review for PR feedback, escalation_resolved for stuck task guidance, pr_merged/pr_closed for PR completion, user_reply for thread replies, cancel for conversation cancellation.",
    inputSchema: SignalConversationInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = SignalConversationInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { conversationId, signalType, payload, message } = parsed.data;

      // Build a Signal object for the executor
      const signal: Signal = {
        type: signalType,
        data: payload,
        message,
        source: "router",
      };

      try {
        const result = await deps.executor.signal(conversationId, signal);

        deps.logger.info(
          { conversationId, signalType, action: result.action },
          `signal_conversation: signal ${result.action}`,
        );

        return {
          content: JSON.stringify({
            signaled: true,
            conversationId,
            signalType,
            action: result.action,
          }),
        };
      } catch (error) {
        const isNotFound =
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("does not exist"));

        if (isNotFound) {
          deps.logger.warn(
            { conversationId, signalType },
            "signal_conversation: conversation not found",
          );
          return {
            content: `Conversation "${conversationId}" not found. It may have already completed or been cancelled.`,
            isError: true,
          };
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error, conversationId, signalType },
          "signal_conversation: failed to send signal",
        );
        return {
          content: `Failed to signal conversation: ${errorMessage}`,
          isError: true,
        };
      }
    },
  };
}
