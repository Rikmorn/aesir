/**
 * task:respond Tool Factory
 *
 * Sends a handshake response (accept or reject) back to the delegating agent.
 * This is the target agent's side of the delegation handshake:
 * - accept: transitions task to "active", sends task_handshake signal to delegator
 * - reject: keeps task as "created", sends task_handshake signal with rejection reason
 *
 * Orphan case (delegator gone): response is recorded gracefully with guidance
 * to proceed if accepted, since completion signaling will handle result delivery.
 */

import { z } from "zod";
import type { Signal, ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

const RespondTaskInputSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  response: z
    .enum(["accept", "reject"])
    .describe("Accept or reject the delegation"),
  estimate: z
    .string()
    .optional()
    .describe(
      'Free-text estimate when accepting (e.g., "~15 minutes", "2 tool calls")',
    ),
  reason: z
    .string()
    .optional()
    .describe("Rejection reason when rejecting the delegation"),
});

/**
 * Create the task:respond tool.
 *
 * Requires ctx.delegationDeps to be populated (by the worker loop when
 * the agent has task:respond or task:delegate in its tools). Returns a
 * descriptive error if delegation dependencies are not available.
 */
export function createRespondTaskTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "respond_task",
    description:
      "Respond to a delegated task with accept or reject. Sends a task_handshake " +
      "signal back to the delegating agent's conversation. Accept transitions the " +
      "task to active status; reject keeps it as created. Include an estimate when " +
      "accepting or a reason when rejecting.",
    inputSchema: RespondTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      // a. Check delegationDeps exists
      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for delegation responses.",
          isError: true,
        };
      }

      // b. Parse and validate input
      const parsed = RespondTaskInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        // c. Get the delegated task
        const task = await deps.taskService.get(parsed.data.taskId);
        if (!task) {
          return {
            content: `Task not found: ${parsed.data.taskId}`,
            isError: true,
          };
        }

        if (!task.parent_id) {
          return {
            content:
              "This task has no parent -- nothing to respond to. This tool is for responding to delegated tasks.",
            isError: true,
          };
        }

        // d. Find the delegator's active conversation
        const parentConv = await deps.executor.findActiveForTask(
          task.parent_id,
        );

        if (!parentConv) {
          // Orphan case: delegator gone
          // If accepted, still transition the task so work can proceed
          if (parsed.data.response === "accept") {
            await deps.taskService.update(parsed.data.taskId, {
              status: "active",
            });
          }

          return {
            content:
              "Delegator conversation not found (may have timed out or completed). " +
              "Your handshake response has been recorded. If you accepted, proceed " +
              "with the work -- completion signaling will handle result delivery.",
          };
        }

        // e. Build signal (self-contained payload)
        const signal: Signal = {
          type: "task_handshake",
          data: {
            taskId: parsed.data.taskId,
            response: parsed.data.response,
            ...(parsed.data.estimate && { estimate: parsed.data.estimate }),
            ...(parsed.data.reason && { reason: parsed.data.reason }),
            respondedBy: ctx.agentId,
          },
          message:
            parsed.data.response === "accept"
              ? `Delegation accepted for task ${parsed.data.taskId}.${parsed.data.estimate ? ` Estimate: ${parsed.data.estimate}` : ""}`
              : `Delegation rejected for task ${parsed.data.taskId}.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ""}`,
          source: `agent:${ctx.agentId}`,
          deduplicationId: `handshake-${parsed.data.taskId}`,
        };

        // f. Send signal to delegator's conversation
        const result = await deps.executor.signal(parentConv.id, signal);

        // g. If accepted, transition task to active
        if (parsed.data.response === "accept") {
          await deps.taskService.update(parsed.data.taskId, {
            status: "active",
          });
        }

        // h. Return success message
        const detail =
          parsed.data.response === "accept"
            ? parsed.data.estimate
              ? ` Estimate: ${parsed.data.estimate}.`
              : ""
            : parsed.data.reason
              ? ` Reason: ${parsed.data.reason}.`
              : "";

        return {
          content: `Handshake ${parsed.data.response} sent for task ${parsed.data.taskId}. Signal delivery: ${result.action}.${detail}`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to respond to task: ${message}`,
          isError: true,
        };
      }
    },
  };
}
