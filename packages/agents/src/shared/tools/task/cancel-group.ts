/**
 * task:cancel_group Tool Factory
 *
 * Cancels all remaining tasks in a delegation group by sending task_cancelled
 * signals to each running task's conversation. Tasks in terminal state
 * (completed, failed, cancelled) are skipped. The group status is transitioned
 * to "cancelled" and any group timeout job is cancelled.
 *
 * Cancellation flow:
 * 1. Verify group exists and is not already terminal
 * 2. For each non-terminal task: find active conversation, send task_cancelled signal
 * 3. Update task status to cancelled
 * 4. Update group status to cancelled
 * 5. Cancel group timeout job if one exists
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

// ─── Input Schema ───────────────────────────────────────────────────────────

const CancelGroupInputSchema = z.object({
  groupId: z.string().min(1).describe("ID of the group to cancel"),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_GROUP_STATUSES = new Set(["cancelled", "settled"]);

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the task:cancel_group tool.
 *
 * Requires ctx.delegationDeps with groupService to be populated.
 */
export function createCancelGroupTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "cancel_group",
    description:
      "Cancel all remaining tasks in a delegation group. Sends task_cancelled signal " +
      "to each running task, giving target agents one cleanup turn before termination. " +
      "Tasks already in terminal state (completed, failed, cancelled) are not affected.",
    inputSchema: CancelGroupInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = CancelGroupInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for delegation.",
          isError: true,
        };
      }

      if (!deps.groupService) {
        return {
          content:
            "Group cancellation not available -- groupService is not configured.",
          isError: true,
        };
      }

      const { groupId } = parsed.data;

      try {
        const state = await deps.groupService.getGroupState(groupId);

        // Check if group is already in terminal state
        if (TERMINAL_GROUP_STATUSES.has(state.status)) {
          return {
            content: `Group ${groupId} is already in terminal state: ${state.status}. No action taken.`,
          };
        }

        // Cancel each non-terminal task
        let cancelledCount = 0;
        let alreadyTerminalCount = 0;
        const cancelErrors: string[] = [];

        for (const task of state.tasks) {
          if (TERMINAL_STATUSES.has(task.status)) {
            alreadyTerminalCount++;
            continue;
          }

          try {
            // Find active conversation for this task
            const conv = await deps.executor.findActiveForTask(task.taskId);
            if (conv) {
              // Send task_cancelled signal
              await deps.executor.signal(conv.id, {
                type: "task_cancelled",
                data: {
                  taskId: task.taskId,
                  groupId,
                  reason: "Group cancelled by delegator",
                },
                message:
                  "Your task has been cancelled. You have one turn to clean up (save artifacts, add comments, mark status).",
                source: `agent:${ctx.agentId}`,
                deduplicationId: `cancel-${task.taskId}`,
              });
            }

            // Update task status to cancelled
            await deps.taskService.update(task.taskId, {
              status: "cancelled",
            });
            cancelledCount++;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            cancelErrors.push(`Task ${task.taskId}: ${message}`);
          }
        }

        // Update group status to cancelled
        await deps.groupService.updateStatus(groupId, "cancelled");

        // Cancel group timeout job if one exists
        if (state.timeoutJobId && deps.timeoutScheduler) {
          try {
            await deps.timeoutScheduler.cancel(state.timeoutJobId);
          } catch {
            // Best-effort: timeout may have already fired
          }
        }

        // Build response
        const lines = [
          `Group ${groupId} cancelled.`,
          `Tasks cancelled: ${cancelledCount}`,
          `Tasks already terminal: ${alreadyTerminalCount}`,
        ];

        if (cancelErrors.length > 0) {
          lines.push(
            "",
            "Errors during cancellation (tasks may still be running):",
            ...cancelErrors.map((e) => `  - ${e}`),
          );
        }

        return { content: lines.join("\n") };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (message.includes("not found")) {
          return {
            content: `Group not found: ${groupId}`,
            isError: true,
          };
        }
        return {
          content: `Failed to cancel group: ${message}`,
          isError: true,
        };
      }
    },
  };
}
