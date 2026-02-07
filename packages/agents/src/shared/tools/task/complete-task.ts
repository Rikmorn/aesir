/**
 * complete_task Tool Factory
 *
 * Marks a task as completed with a structured completion handoff.
 * Atomically transitions status and records handoff in one call.
 * Validates status transition via VALID_TRANSITIONS map.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";
import { formatValidTransitions, isValidTransition } from "./types.js";

const CompleteTaskInputSchema = z.object({
  taskId: z
    .string()
    .optional()
    .describe(
      "Task ID to complete. Defaults to the current conversation's task.",
    ),
  summary: z.string().describe("Summary of what was accomplished on this task"),
  key_decisions: z
    .array(z.string())
    .optional()
    .describe("Key decisions made during execution"),
  artifacts: z
    .record(z.unknown())
    .optional()
    .describe("Artifacts produced (e.g., PR URLs, file paths)"),
  next_steps: z
    .string()
    .optional()
    .describe("Recommended next steps after completion"),
});

export function createCompleteTaskTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "complete_task",
    description:
      "Mark a task as completed with a structured completion handoff. " +
      "Requires a summary of what was accomplished. Optionally include key decisions, " +
      "artifacts, and next steps for context handoff to future agents.",
    inputSchema: CompleteTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = CompleteTaskInputSchema.safeParse(input);
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

        if (!isValidTransition(task.status, "completed")) {
          return {
            content: `Cannot complete ${taskId}: status is "${task.status}".\nValid transitions from ${task.status}: ${formatValidTransitions(task.status)}`,
            isError: true,
          };
        }

        await taskService.transitionWithHandoff(taskId, "completed", {
          conversationId: ctx.correlationId,
          handoffType: "completion",
          context: {
            summary: parsed.data.summary,
            key_decisions: parsed.data.key_decisions,
            artifacts: parsed.data.artifacts,
            next_steps: parsed.data.next_steps,
          },
          authorType: "agent",
          authorId: ctx.agentId,
        });

        return {
          content: `Task completed: ${taskId}\nStatus: completed`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to complete task ${taskId}: ${message}`,
          isError: true,
        };
      }
    },
  };
}
