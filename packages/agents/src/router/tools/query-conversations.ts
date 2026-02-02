/**
 * Query Conversations Tool
 *
 * Router tool that queries running conversations via ConversationExecutor.
 * Adapted from query-workflows.ts for v2.3 -- replaces Temporal visibility
 * API queries with ConversationExecutor.list() and .get() calls.
 *
 * Returns up to 20 conversation summaries with ID, status, and agent type.
 *
 * Both this file and query-workflows.ts coexist until Phase 47 cleanup.
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
  taskId: z
    .string()
    .optional()
    .describe(
      "Filter by task ID to check if a specific conversation exists (checks dev-agent-{taskId} and product-agent-{taskId} patterns)",
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
 * Queries conversations via ConversationExecutor. When a taskId is provided,
 * searches by conversation ID patterns (dev-agent-{taskId} and
 * product-agent-{taskId}). Otherwise lists conversations with optional
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

      const { taskId, agentDefinitionId } = parsed.data;

      try {
        // If taskId provided, search by conversation ID patterns
        if (taskId) {
          const results: Array<{
            conversationId: string;
            status: string;
            agentDefinitionId: string;
          }> = [];

          // Check both dev-agent and product-agent patterns
          const patterns = [`dev-agent-${taskId}`, `product-agent-${taskId}`];

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
