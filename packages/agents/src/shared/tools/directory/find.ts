/**
 * directory_find Tool Factory
 *
 * Finds agents or entities by capability using semantic search.
 * Returns matching entities ranked by relevance, excluding the calling agent.
 *
 * Graceful degradation (DIR-06): never throws, returns empty on error.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { DirectoryService } from "../../services/directory-service.js";

const DirectoryFindInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Describe the capability you need, e.g. 'implement code changes and create pull requests'",
    ),
});

export function createDirectoryFindTool(
  directoryService: DirectoryService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "directory_find",
    description:
      "Find agents or entities by capability. Describe what you need done and get matching agents ranked by relevance. " +
      "Use this before delegating work to discover who can help.",
    inputSchema: DirectoryFindInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = DirectoryFindInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const results = await directoryService.find(
          parsed.data.query,
          ctx.agentId,
        );

        if (results.length === 0) {
          return {
            content: "No matching entities found for this capability.",
          };
        }

        // Format results as structured text
        const formatted = results
          .map(
            (entry, idx) =>
              `${idx + 1}. **${entry.name}** (${entry.id})\n` +
              `   Type: ${entry.type}\n` +
              `   Capabilities: ${entry.capabilities.join(", ")}`,
          )
          .join("\n\n");

        return {
          content: `Found ${results.length} matching entities:\n\n${formatted}`,
        };
      } catch {
        // DIR-06: graceful degradation -- never crash, return empty
        return {
          content: "No matching entities found for this capability.",
        };
      }
    },
  };
}
