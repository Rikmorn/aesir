/**
 * knowledge_query Tool Factory
 *
 * Searches shared knowledge stored by any agent via semantic search.
 * Returns entries matching the query, filtered by optional type/topic.
 * Results include shared entries from all agents and the caller's
 * own private entries.
 *
 * Graceful degradation (MEM-08): never throws, returns empty on error.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { KnowledgeService } from "../../services/knowledge-service.js";
import { KNOWLEDGE_TYPES } from "./types.js";

const KnowledgeQueryInputSchema = z.object({
  query: z.string().min(1).describe("Semantic search text"),
  type: z.enum(KNOWLEDGE_TYPES).optional().describe("Filter by knowledge type"),
  topic: z.string().optional().describe("Exact topic match (case-insensitive)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Max results (default 10)"),
});

export function createKnowledgeQueryTool(
  knowledgeService: KnowledgeService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "knowledge_query",
    description:
      "Search shared knowledge stored by any agent. Returns entries matching the semantic query, " +
      "filtered by optional type and topic. Results include shared entries from all agents and your own private entries.",
    inputSchema: KnowledgeQueryInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = KnowledgeQueryInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const results = await knowledgeService.query({
          ...parsed.data,
          agentId: ctx.agentId,
        });

        if (results.length === 0) {
          return { content: "No matching knowledge entries found." };
        }

        // Format results as structured text
        const formatted = results
          .map(
            (entry) =>
              `[${entry.id}] ${entry.type} | ${entry.topic}\n` +
              `  Author: ${entry.author} | Created: ${entry.createdAt}\n` +
              `  ${entry.content}`,
          )
          .join("\n\n");

        return {
          content: `Found ${results.length} knowledge entries:\n\n${formatted}`,
        };
      } catch {
        // MEM-08: graceful degradation -- never crash, return empty
        return { content: "No matching knowledge entries found." };
      }
    },
  };
}
