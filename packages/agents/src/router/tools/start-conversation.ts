/**
 * Start Conversation Tool
 *
 * Router tool that starts a new conversation via ConversationExecutor.
 * Adapted from start-workflow.ts for v2.3 -- replaces Temporal workflowClient
 * with ConversationExecutor.start().
 *
 * The executor generates a deterministic conversation ID from the correlation key,
 * and handles idempotency natively (same correlationKey returns existing ID).
 *
 * Both this file and start-workflow.ts coexist until Phase 47 cleanup.
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

const StartConversationInputSchema = z.object({
  agentDefinitionId: z
    .enum(["dev-agent", "product-agent"])
    .describe("Which agent to start"),
  correlationKey: z
    .string()
    .describe(
      "Correlation key for deterministic conversation ID (e.g., Linear issue UUID or Slack threadTs)",
    ),
  input: z
    .record(z.unknown())
    .describe(
      "Initial message context object (serialized as the conversation's initial message)",
    ),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the start_conversation tool definition.
 *
 * Maps the LLM's routing decision to a ConversationExecutor.start() call.
 * The executor generates a deterministic conversation ID from the
 * agentDefinitionId + correlationKey combination.
 *
 * Idempotency: If a conversation with the same ID already exists, the
 * executor returns the existing ID without error.
 *
 * @param deps - Event router dependencies (needs executor)
 * @returns ToolDefinition for the agent loop
 */
export function createStartConversationTool(
  deps: EventRouterDeps,
): ToolDefinition {
  return {
    name: "start_conversation",
    description:
      "Start a new conversation for the specified agent. Use dev-agent for Linear issue work, product-agent for Slack conversations. Provide a correlationKey (issue UUID or thread timestamp) for deterministic ID generation.",
    inputSchema: StartConversationInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = StartConversationInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const {
        agentDefinitionId,
        correlationKey,
        input: conversationInput,
      } = parsed.data;

      try {
        const conversationId = await deps.executor.start({
          agentDefinitionId,
          correlationKey,
          initialMessage: JSON.stringify(conversationInput),
        });

        deps.logger.info(
          { conversationId, agentDefinitionId, correlationKey },
          "start_conversation: conversation started",
        );

        return {
          content: JSON.stringify({ started: true, conversationId }),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error, agentDefinitionId, correlationKey },
          "start_conversation: failed to start conversation",
        );
        return {
          content: `Failed to start conversation: ${message}`,
          isError: true,
        };
      }
    },
  };
}
