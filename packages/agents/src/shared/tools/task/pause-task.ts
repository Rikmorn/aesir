/**
 * pause_task Tool Factory
 *
 * Pauses a task with a structured pause handoff.
 * Atomically transitions status and records handoff in one call.
 * Validates status transition via VALID_TRANSITIONS map.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";
import { formatValidTransitions, isValidTransition } from "./types.js";

const PauseTaskInputSchema = z.object({
  taskId: z
    .string()
    .optional()
    .describe("Task ID to pause. Defaults to the current conversation's task."),
  summary: z
    .string()
    .describe("Summary of current progress and reason for pausing"),
  open_questions: z
    .array(z.string())
    .optional()
    .describe("Unresolved questions that need answers before resuming"),
  next_steps: z
    .string()
    .optional()
    .describe("What should happen when the task is resumed"),
});

export function createPauseTaskTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "pause_task",
    description:
      "Pause a task with a structured pause handoff. " +
      "Requires a summary of current progress. Optionally include open questions " +
      "and next steps so the resuming agent has full context.",
    inputSchema: PauseTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = PauseTaskInputSchema.safeParse(input);
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

        if (!isValidTransition(task.status, "paused")) {
          return {
            content: `Cannot pause ${taskId}: status is "${task.status}".\nValid transitions from ${task.status}: ${formatValidTransitions(task.status)}`,
            isError: true,
          };
        }

        await taskService.update(taskId, { status: "paused" });
        await taskService.addHandoff({
          taskId,
          conversationId: ctx.correlationId,
          handoffType: "pause",
          context: {
            summary: parsed.data.summary,
            open_questions: parsed.data.open_questions,
            next_steps: parsed.data.next_steps,
          },
          authorType: "agent",
          authorId: ctx.agentId,
        });

        return {
          content: `Task paused: ${taskId}\nStatus: paused`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to pause task ${taskId}: ${message}`,
          isError: true,
        };
      }
    },
  };
}
