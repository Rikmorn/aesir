/**
 * Query Conversations Tool
 *
 * Router tool that queries running conversations via ConversationExecutor.
 * Uses ConversationExecutor.list() and .get() calls.
 *
 * Returns up to 20 conversation summaries with ID, status, and agent type.
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

const QueryConversationsInputSchema = z.object({
  correlationRef: z
    .string()
    .optional()
    .describe(
      "Filter by correlation reference to check if a specific conversation exists (checks dev-agent-{correlationRef} and product-agent-{correlationRef} patterns)",
    ),
  agentDefinitionId: z
    .enum(["dev-agent", "product-agent"])
    .optional()
    .describe("Filter by agent type"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the query_conversations tool definition.
 *
 * Queries conversations via ConversationExecutor. When a correlationRef is provided,
 * searches by conversation ID patterns (dev-agent-{correlationRef} and
 * product-agent-{correlationRef}). Otherwise lists conversations with optional
 * agent type filter.
 *
 * @param deps - Event router dependencies (needs executor)
 * @returns ToolDefinition for the agent loop
 */
export function createQueryConversationsTool(
  deps: EventRouterDeps,
): ToolDefinition {
  return {
    name: "query_conversations",
    description:
      "List running conversations. Use to check if a conversation exists before signaling it. Returns conversation IDs, statuses, and agent types.",
    inputSchema: QueryConversationsInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = QueryConversationsInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { correlationRef, agentDefinitionId } = parsed.data;

      try {
        // If correlationRef provided, search by conversation ID patterns
        if (correlationRef) {
          const results: Array<{
            conversationId: string;
            status: string;
            agentDefinitionId: string;
          }> = [];

          // Check both dev-agent and product-agent patterns
          const patterns = [
            `dev-agent-${correlationRef}`,
            `product-agent-${correlationRef}`,
          ];

          for (const conversationId of patterns) {
            const info = await deps.executor.get(conversationId);
            if (info) {
              results.push({
                conversationId: info.id,
                status: info.status,
                agentDefinitionId: info.agentDefinitionId,
              });
            }
          }

          return { content: JSON.stringify(results, null, 2) };
        }

        // Otherwise, list conversations with optional filters
        const listOptions: {
          agentDefinitionId?: string;
          limit?: number;
        } = { limit: 20 };
        if (agentDefinitionId) {
          listOptions.agentDefinitionId = agentDefinitionId;
        }
        const conversations = await deps.executor.list(listOptions);

        const results = conversations.map((c) => ({
          conversationId: c.id,
          status: c.status,
          agentDefinitionId: c.agentDefinitionId,
        }));

        return { content: JSON.stringify(results, null, 2) };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error },
          "query_conversations: failed to list conversations",
        );
        return {
          content: `Failed to query conversations: ${message}`,
          isError: true,
        };
      }
    },
  };
}
