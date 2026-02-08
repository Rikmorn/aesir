/**
 * create_task Tool Factory
 *
 * Creates a new task and optionally links it to the current conversation.
 *
 * Linking behavior (per CONTEXT.md locked decision):
 * - ctx.taskId is undefined: create task, link conversation, mutate ctx.taskId
 * - ctx.taskId already set: create task in DB, return ID, no link, no ctx mutation
 *
 * Hierarchy guardrails (Phase 59):
 * - Max depth of parent chains: MAX_TASK_DEPTH (5)
 * - Max subtasks per parent: MAX_SUBTASKS_PER_PARENT (10)
 * - Circular delegation detection: non-consecutive same-assignee blocked (A->B->A)
 * - Consecutive same-assignee allowed (self-decomposition: A->A->A)
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { TaskService } from "../../services/task-service.js";
import { MAX_SUBTASKS_PER_PARENT, MAX_TASK_DEPTH } from "./types.js";

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

/**
 * Walk the parent chain and verify depth would not exceed MAX_TASK_DEPTH.
 * Returns a ToolResult error if the limit would be exceeded or the chain is broken.
 * Returns null if the depth is valid.
 */
async function checkDepth(
  taskService: TaskService,
  parentId: string,
): Promise<ToolResult | null> {
  let currentId: string | null = parentId;
  let depth = 1; // The new task is at depth 1 relative to its parent

  while (currentId !== null) {
    if (depth >= MAX_TASK_DEPTH) {
      return {
        content: `Cannot create subtask: would exceed maximum nesting depth of ${MAX_TASK_DEPTH} levels. Current depth: ${depth}.`,
        isError: true,
      };
    }

    const task = await taskService.get(currentId);
    if (!task) {
      return {
        content: `Cannot create subtask: parent chain is broken at ${currentId}. Verify the parent task exists.`,
        isError: true,
      };
    }

    currentId = task.parent_id ?? null;
    depth++;
  }

  return null;
}

/**
 * Check that the parent does not already have MAX_SUBTASKS_PER_PARENT children.
 * Returns a ToolResult error if the cap would be exceeded, null otherwise.
 */
async function checkSubtaskCap(
  taskService: TaskService,
  parentId: string,
): Promise<ToolResult | null> {
  const children = await taskService.listByParent(parentId);
  if (children.length >= MAX_SUBTASKS_PER_PARENT) {
    return {
      content: `Cannot create subtask: parent ${parentId} already has ${children.length} subtasks (maximum ${MAX_SUBTASKS_PER_PARENT}).`,
      isError: true,
    };
  }
  return null;
}

/**
 * Detect circular delegation by walking the parent chain.
 *
 * Rule: consecutive same-assignee (A->A->A) = self-decomposition, ALLOWED.
 *       non-consecutive same-assignee (A->B->A) = circular delegation, BLOCKED.
 *
 * Algorithm: walk from parent upward, tracking whether a different assignee
 * has been encountered. If the new task's assignee reappears after a different
 * assignee, it's circular delegation.
 *
 * Loop is bounded by MAX_TASK_DEPTH to prevent runaway queries on corrupt data.
 */
async function checkCircularDelegation(
  taskService: TaskService,
  parentId: string,
  newAssigneeType: string,
  newAssigneeId: string,
): Promise<ToolResult | null> {
  let currentId: string | null = parentId;
  let seenDifferentAssignee = false;
  let iterations = 0;

  while (currentId !== null && iterations < MAX_TASK_DEPTH) {
    const task = await taskService.get(currentId);
    if (!task) {
      return {
        content: `Cannot create subtask: parent chain is broken at ${currentId}. Verify the parent task exists.`,
        isError: true,
      };
    }

    const sameAssignee =
      task.assignee_type === newAssigneeType &&
      task.assignee_id === newAssigneeId;

    if (sameAssignee && seenDifferentAssignee) {
      return {
        content: `Cannot create subtask: circular delegation detected. ${newAssigneeId} appears in the ancestor chain after a different assignee. This creates a delegation cycle (A delegates to B delegates back to A).`,
        isError: true,
      };
    }

    if (!sameAssignee) {
      seenDifferentAssignee = true;
    }

    currentId = task.parent_id ?? null;
    iterations++;
  }

  return null;
}

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
        // Hierarchy guardrails: validate before creating (only for subtasks)
        if (parentId) {
          const depthError = await checkDepth(taskService, parentId);
          if (depthError) return depthError;

          const capError = await checkSubtaskCap(taskService, parentId);
          if (capError) return capError;

          const circularError = await checkCircularDelegation(
            taskService,
            parentId,
            assigneeType,
            assigneeId,
          );
          if (circularError) return circularError;
        }

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
