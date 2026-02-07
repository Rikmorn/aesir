/**
 * get_task_context Tool Factory
 *
 * Returns the full task context as a chronological narrative:
 * task metadata followed by all handoffs in chronological order.
 * Designed for LLM consumption -- flat plain text, not JSON.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";
import { formatHandoffContext } from "./format.js";

const GetTaskContextInputSchema = z.object({
  taskId: z
    .string()
    .optional()
    .describe(
      "Task ID to retrieve context for. Defaults to the current conversation's task.",
    ),
});

export function createGetTaskContextTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "get_task_context",
    description:
      "Get the full context for a task: metadata and all handoffs in chronological order. " +
      "Returns the complete task narrative showing how work has progressed across conversations.",
    inputSchema: GetTaskContextInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = GetTaskContextInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const taskId = parsed.data.taskId ?? ctx.taskId;
      if (!taskId) {
        return {
          content:
            "No task ID provided and no task associated with this conversation.",
          isError: true,
        };
      }

      try {
        const task = await taskService.get(taskId);
        if (!task) {
          return { content: `Task not found: ${taskId}`, isError: true };
        }

        // Fetch handoffs in DESC order (service default), then reverse for chronological
        const handoffs = await taskService.getHandoffs(taskId);
        const chronological = [...handoffs].reverse();

        // Build task metadata block
        const lines: string[] = [];
        lines.push(`Task: ${task.id}`);
        lines.push(`Title: ${task.title}`);
        if (task.objective) lines.push(`Objective: ${task.objective}`);
        lines.push(`Status: ${task.status}`);
        lines.push(`Assignee: ${task.assignee_type}:${task.assignee_id}`);
        lines.push(`Created: ${task.created_at.toISOString().slice(0, 10)}`);

        if (chronological.length === 0) {
          lines.push("");
          lines.push("No handoffs recorded yet.");
          return { content: lines.join("\n") };
        }

        lines.push("");
        lines.push(`--- Handoffs (${chronological.length}) ---`);

        for (let i = 0; i < chronological.length; i++) {
          const handoff = chronological[i];
          if (!handoff) continue;
          lines.push("");
          lines.push(
            `${i + 1}. [${handoff.handoff_type}] ${handoff.created_at.toISOString().slice(0, 16)} by ${handoff.author_type}:${handoff.author_id}`,
          );
          const formatted = formatHandoffContext(handoff);
          if (formatted) lines.push(formatted);
        }

        return { content: lines.join("\n") };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to get task context for ${taskId}: ${message}`,
          isError: true,
        };
      }
    },
  };
}
