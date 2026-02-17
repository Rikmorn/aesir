/**
 * knowledge_store Tool Factory
 *
 * Stores a knowledge entry that persists across conversations.
 * Agents provide type, topic, and content; author is extracted
 * from ToolContext (not user input). Scope defaults from type,
 * expiry calculated automatically.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { KnowledgeService } from "../../services/knowledge-service.js";
import { KNOWLEDGE_TYPES } from "./types.js";

const KnowledgeStoreInputSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPES).describe("Knowledge classification"),
  topic: z
    .string()
    .min(1)
    .describe("Short label for this knowledge (used for deduplication)"),
  content: z
    .string()
    .min(1)
    .describe("The knowledge content (max 2000 characters)"),
  scope: z
    .enum(["shared", "private"])
    .optional()
    .describe("Override default visibility scope"),
  tags: z.array(z.string()).optional().describe("Optional filtering labels"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Structured metadata for exact-match queries (e.g., { issueId: 'LIN-456', prNumber: 42 })",
    ),
});

export function createKnowledgeStoreTool(
  knowledgeService: KnowledgeService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "knowledge_store",
    description:
      "Store a knowledge entry that persists across conversations. Optionally attach structured metadata for exact-match retrieval. " +
      "Types: discovery (24h, what you found), constraint (30d, limitations/rules), architecture_decision (7d, design choices), " +
      "thought (24h, private reasoning), preference (30d, project/user preferences), test_result (7d, test outcomes). " +
      "Duplicate topics with the same type are automatically updated.",
    inputSchema: KnowledgeStoreInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = KnowledgeStoreInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const result = await knowledgeService.store({
          ...parsed.data,
          author: ctx.agentId,
        });

        return {
          content: `Stored: ${result.id} [${result.type}] ${result.topic}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to store knowledge: ${message}`,
          isError: true,
        };
      }
    },
  };
}
