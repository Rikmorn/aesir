/**
 * knowledge_update Tool Factory
 *
 * Updates existing knowledge entries via two actions:
 * - supersede: Replace with updated content (creates new entry, marks old as replaced)
 * - invalidate: Mark an entry as no longer valid with optional reason
 *
 * Both actions exclude affected entries from future queries.
 * Author is extracted from ToolContext (not user input).
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { KnowledgeService } from "../../services/knowledge-service.js";
import { KNOWLEDGE_TYPES } from "./types.js";

const KnowledgeUpdateInputSchema = z.object({
  id: z.string().describe("ID of the knowledge entry to update"),
  action: z.enum(["supersede", "invalidate"]).describe("Update action"),
  // Supersede fields
  content: z
    .string()
    .min(1)
    .optional()
    .describe("New content (required for supersede)"),
  type: z
    .enum(KNOWLEDGE_TYPES)
    .optional()
    .describe("Override type (supersede only)"),
  topic: z.string().optional().describe("Override topic (supersede only)"),
  // Invalidate fields
  reason: z.string().optional().describe("Reason for invalidation"),
});

export function createKnowledgeUpdateTool(
  knowledgeService: KnowledgeService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "knowledge_update",
    description:
      "Update an existing knowledge entry. Use 'supersede' to replace with updated content " +
      "(creates a new entry, marks old as replaced). Use 'invalidate' to mark an entry as no longer valid. " +
      "Superseded/invalidated entries are excluded from future queries.",
    inputSchema: KnowledgeUpdateInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = KnowledgeUpdateInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { id, action, content, type, topic, reason } = parsed.data;

      try {
        if (action === "supersede") {
          if (!content) {
            return {
              content: "content is required for supersede action",
              isError: true,
            };
          }

          const result = await knowledgeService.supersede(id, {
            content,
            author: ctx.agentId,
            ...(type && { type }),
            ...(topic && { topic }),
          });

          return {
            content: `Superseded: ${result.id} [${result.type}] ${result.topic} (replaces ${id})`,
          };
        }

        // action === "invalidate"
        await knowledgeService.invalidate(id, reason);

        return {
          content: `Invalidated: ${id}${reason ? ` — ${reason}` : ""}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to update knowledge: ${message}`,
          isError: true,
        };
      }
    },
  };
}
