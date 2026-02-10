/**
 * directory_get Tool Factory
 *
 * Retrieves full details about a specific entity by ID.
 * Returns capabilities, reach_via, and metadata.
 * Returns not-found message (not isError) for missing/inactive entities.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { DirectoryService } from "../../services/directory-service.js";

const DirectoryGetInputSchema = z.object({
  entity_id: z
    .string()
    .min(1)
    .describe("Entity ID to look up (e.g., 'dev-agent')"),
});

export function createDirectoryGetTool(
  directoryService: DirectoryService,
): ToolDefinition {
  return {
    name: "directory_get",
    description:
      "Get full details about a specific entity by ID. Returns capabilities, reach_via, and metadata. " +
      "Use this after directory_find to get more context about a specific agent before delegating.",
    inputSchema: DirectoryGetInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = DirectoryGetInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const entry = await directoryService.get(parsed.data.entity_id);

      if (!entry) {
        return {
          content: `Entity not found: ${parsed.data.entity_id}`,
        };
      }

      // Format full entity details
      const lines = [
        `**${entry.name}** (${entry.id})`,
        `Type: ${entry.type}`,
        `Description: ${entry.description}`,
        `Capabilities: ${entry.capabilities.join(", ")}`,
      ];

      if (entry.reachVia) {
        lines.push(`Reach via: ${JSON.stringify(entry.reachVia)}`);
      }

      if (Object.keys(entry.metadata).length > 0) {
        lines.push(`Metadata: ${JSON.stringify(entry.metadata)}`);
      }

      return { content: lines.join("\n") };
    },
  };
}
