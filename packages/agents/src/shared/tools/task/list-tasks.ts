/**
 * list_tasks Tool Factory
 *
 * Lists tasks by parent (subtasks) or by assignee (agent's own tasks).
 * Returns rich plain text summary rows with optional handoff previews.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";
import { formatTaskSummaryRow } from "./format.js";

const ListTasksInputSchema = z.object({
  parentId: z
    .string()
    .optional()
    .describe(
      "Parent task ID to list subtasks for. If omitted, lists the calling agent's own tasks.",
    ),
  status: z
    .string()
    .optional()
    .describe("Filter by task status (e.g., active, paused, completed)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of tasks to return (default 50)"),
});

export function createListTasksTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "list_tasks",
    description:
      "List tasks. If parentId is provided, lists subtasks of that parent. " +
      "Otherwise, lists tasks assigned to you. Optionally filter by status. " +
      "Returns summary rows with latest handoff preview for each task.",
    inputSchema: ListTasksInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = ListTasksInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        const { parentId, status, limit } = parsed.data;

        // Build filters object omitting undefined values (exactOptionalPropertyTypes)
        const filters: { status?: string; limit?: number } = {};
        if (status !== undefined) filters.status = status;
        if (limit !== undefined) filters.limit = limit;

        const tasks = parentId
          ? await taskService.listByParent(parentId, filters)
          : await taskService.listByAssignee("agent", ctx.agentId, filters);

        if (tasks.length === 0) {
          return { content: "No tasks found matching the query." };
        }

        // Build summary rows with latest handoff preview for each task
        const rows: string[] = [];
        rows.push("ID | Title | Status | Assignee | Created");
        rows.push("---|-------|--------|----------|--------");

        for (const task of tasks) {
          const latestHandoff = await taskService.getLatestHandoff(task.id);
          const summary = latestHandoff
            ? ((latestHandoff.context as Record<string, unknown>)
                .summary as string)
            : undefined;
          rows.push(formatTaskSummaryRow(task, summary));
        }

        return { content: rows.join("\n") };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to list tasks: ${message}`,
          isError: true,
        };
      }
    },
  };
}
