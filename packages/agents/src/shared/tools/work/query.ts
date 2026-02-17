/**
 * work_query Tool Factory
 *
 * Checks if any conversations are currently working on a specific external
 * entity. Returns all correlations (active, completed, failed) to help the
 * agent decide whether to start new work or coordinate with existing work.
 *
 * Validates entityType enum and entityId non-empty via Zod, then delegates
 * to CorrelationService for lookup.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { CorrelationService } from "../../services/correlation-service.js";

const WorkQueryInputSchema = z.object({
  entityType: z
    .enum(["linear_issue", "github_pr", "slack_thread"])
    .describe("Type of external entity"),
  entityId: z
    .string()
    .min(1)
    .describe("External entity identifier"),
});

export function createWorkQueryTool(
  correlationService: CorrelationService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "work_query",
    description:
      "Check if any conversations are currently working on a specific external entity. " +
      "Returns all correlations (active, completed, failed) to help decide whether to " +
      "start new work or coordinate with existing work.",
    inputSchema: WorkQueryInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = WorkQueryInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const results = await correlationService.queryAll(
          parsed.data.entityType,
          parsed.data.entityId,
        );

        if (results.length === 0) {
          return {
            content: "No existing work found for this entity.",
          };
        }

        // Format results as structured text (similar to knowledge_query pattern)
        const formatted = results
          .map(
            (entry) =>
              `[${entry.status}] ${entry.agentId} (conversation: ${entry.conversationId})\n` +
              `  Started: ${entry.createdAt}`,
          )
          .join("\n\n");

        return {
          content:
            `Found ${results.length} work correlation(s) for ${parsed.data.entityType} ${parsed.data.entityId}:\n\n${formatted}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to query work correlations: ${message}`,
          isError: true,
        };
      }
    },
  };
}
