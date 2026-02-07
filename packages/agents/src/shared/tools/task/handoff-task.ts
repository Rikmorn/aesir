/**
 * handoff_task Tool Factory
 *
 * Records a context handoff on a task without changing its status.
 * Used for delegation and escalation handoffs where the status
 * change is handled separately (or not at all).
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";

const HandoffTaskInputSchema = z.object({
  taskId: z
    .string()
    .optional()
    .describe(
      "Task ID to record handoff for. Defaults to the current conversation's task.",
    ),
  handoffType: z
    .enum(["delegation", "escalation"])
    .describe("Type of handoff: delegation (lateral) or escalation (upward)"),
  summary: z
    .string()
    .describe("Summary of current state and reason for handoff"),
  key_decisions: z
    .array(z.string())
    .optional()
    .describe("Key decisions made so far"),
  artifacts: z
    .record(z.unknown())
    .optional()
    .describe("Artifacts produced (e.g., PR URLs, file paths)"),
  open_questions: z
    .array(z.string())
    .optional()
    .describe("Unresolved questions for the receiving agent"),
  next_steps: z
    .string()
    .optional()
    .describe("Recommended next steps for the receiving agent"),
});

export function createHandoffTaskTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "handoff_task",
    description:
      "Record a context handoff on a task without changing its status. " +
      "Use for delegation (handing off to a peer) or escalation (handing up to a supervisor). " +
      "Captures summary, decisions, artifacts, and open questions for the receiving agent.",
    inputSchema: HandoffTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = HandoffTaskInputSchema.safeParse(input);
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

        await taskService.addHandoff({
          taskId,
          conversationId: ctx.correlationId,
          handoffType: parsed.data.handoffType,
          context: {
            summary: parsed.data.summary,
            key_decisions: parsed.data.key_decisions,
            artifacts: parsed.data.artifacts,
            open_questions: parsed.data.open_questions,
            next_steps: parsed.data.next_steps,
          },
          authorType: "agent",
          authorId: ctx.agentId,
        });

        return {
          content: `Handoff recorded for: ${taskId}\nType: ${parsed.data.handoffType}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to record handoff for task ${taskId}: ${message}`,
          isError: true,
        };
      }
    },
  };
}
