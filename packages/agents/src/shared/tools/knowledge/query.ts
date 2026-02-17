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
  mode: z
    .enum(["semantic", "exact", "combined"])
    .optional()
    .describe(
      "Search mode: 'semantic' (default) for embedding search, 'exact' for metadata match only, 'combined' for metadata filter + semantic ranking",
    ),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Metadata filter for exact/combined mode. Uses JSONB containment (@>). Example: { issueId: 'LIN-456' }",
    ),
});

export function createKnowledgeQueryTool(
  knowledgeService: KnowledgeService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "knowledge_query",
    description:
      "Search shared knowledge stored by any agent. Supports three modes: 'semantic' (default) for embedding-based search, " +
      "'exact' for metadata-only lookup (e.g., find entries tagged with a specific issue ID), and 'combined' for " +
      "metadata-filtered semantic ranking. Results include shared entries from all agents and your own private entries.",
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
          .map((entry) => {
            let text =
              `[${entry.id}] ${entry.type} | ${entry.topic}\n` +
              `  Author: ${entry.author} | Created: ${entry.createdAt}`;
            if (entry.metadata && Object.keys(entry.metadata).length > 0) {
              text += `\n  Metadata: ${JSON.stringify(entry.metadata)}`;
            }
            text += `\n  ${entry.content}`;
            return text;
          })
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
