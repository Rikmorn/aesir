/**
 * work_register Tool Factory
 *
 * Registers that the current conversation is working on an external entity.
 * Agents use this when they discover they're working on a specific issue,
 * PR, or thread that wasn't the original trigger entity.
 *
 * Validates entityType enum and entityId non-empty via Zod, then delegates
 * to CorrelationService for persistence.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { CorrelationService } from "../../services/correlation-service.js";

const WorkRegisterInputSchema = z.object({
  entityType: z
    .enum(["linear_issue", "github_pr", "slack_thread"])
    .describe("Type of external entity"),
  entityId: z
    .string()
    .min(1)
    .describe(
      'External entity identifier (e.g., issue ID, "owner/repo#123", "channel:thread")',
    ),
});

export function createWorkRegisterTool(
  correlationService: CorrelationService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "work_register",
    description:
      "Register that this conversation is working on an external entity. " +
      "Use when you discover you're working on a specific issue, PR, or thread " +
      "that wasn't the original trigger entity.",
    inputSchema: WorkRegisterInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = WorkRegisterInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        await correlationService.register({
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          conversationId: ctx.correlationId,
          agentId: ctx.agentId,
        });

        return {
          content: `Registered: working on ${parsed.data.entityType} ${parsed.data.entityId}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to register work correlation: ${message}`,
          isError: true,
        };
      }
    },
  };
}
