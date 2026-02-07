/**
 * create_task Tool Factory
 *
 * Creates a new task and optionally links it to the current conversation.
 *
 * Linking behavior (per CONTEXT.md locked decision):
 * - ctx.taskId is undefined: create task, link conversation, mutate ctx.taskId
 * - ctx.taskId already set: create task in DB, return ID, no link, no ctx mutation
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";

const CreateTaskInputSchema = z.object({
  title: z.string().describe("Title for the new task"),
  objective: z.string().optional().describe("Detailed objective for the task"),
  assigneeType: z
    .enum(["agent", "human"])
    .describe("Type of assignee: agent or human"),
  assigneeId: z.string().describe("ID of the assignee agent or human"),
  parentId: z
    .string()
    .optional()
    .describe("Parent task ID for creating subtasks"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Optional metadata key-value pairs"),
});

export function createCreateTaskTool(
  taskService: TaskService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "create_task",
    description:
      "Create a new task to track a unit of work. Tasks can be assigned to agents or humans. " +
      "Optionally specify a parentId to create subtasks. The first task created in a conversation " +
      "is automatically linked to it; subsequent tasks are standalone.",
    inputSchema: CreateTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = CreateTaskInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { title, objective, assigneeType, assigneeId, parentId, metadata } =
        parsed.data;

      try {
        const task = await taskService.create({
          title,
          objective,
          assigneeType,
          assigneeId,
          parentId,
          metadata,
          creatorType: "agent",
          creatorId: ctx.agentId,
          status: "active",
        });

        // Conditional linking: only link if conversation has no task yet
        if (ctx.taskId === undefined) {
          try {
            await taskService.linkConversation(task.id, ctx.correlationId);
            ctx.taskId = task.id;
            return {
              content: `Task created: ${task.id}\nStatus: active\nConversation linked to this task.`,
            };
          } catch (linkError) {
            ctx.logger.error(
              {
                err: linkError,
                taskId: task.id,
                conversationId: ctx.correlationId,
              },
              "Failed to link conversation to task",
            );
            return {
              content: `Task created: ${task.id}\nStatus: active\nWarning: failed to link conversation.`,
            };
          }
        }

        return {
          content: `Task created: ${task.id}\nStatus: active\nTask not linked -- conversation already associated with ${ctx.taskId}.`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to create task: ${message}`,
          isError: true,
        };
      }
    },
  };
}
