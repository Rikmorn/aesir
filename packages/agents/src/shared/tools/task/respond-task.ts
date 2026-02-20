/**
 * task:respond Tool Factory
 *
 * Sends a handshake response (accept, reject, or counter-propose) back to the
 * delegating agent. This is the target agent's side of the delegation handshake:
 * - accept: transitions task to "active", sends task_handshake signal to delegator
 * - reject: keeps task as "created", sends task_handshake signal with rejection reason
 * - counter_propose: transitions task to "counter_proposed", sends task_counter_proposed
 *   signal to delegator, and auto-enters wait_for to await delegator accept/reject
 *
 * Orphan case (delegator gone): response is recorded gracefully with guidance
 * to proceed if accepted, since completion signaling will handle result delivery.
 */

import { z } from "zod";
import type {
  Signal,
  ToolContext,
  WaitForState,
} from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

const AcceptResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z.literal("accept").describe("Accept the delegation"),
  estimate: z
    .string()
    .optional()
    .describe('Free-text estimate (e.g., "~15 minutes")'),
});

const RejectResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z.literal("reject").describe("Reject the delegation"),
  reason: z.string().optional().describe("Rejection reason"),
});

const CounterProposeResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z
    .literal("counter_propose")
    .describe("Counter-propose with modified scope/approach"),
  proposal: z
    .string()
    .min(1)
    .describe("Free-text description of your proposed modification"),
  reason: z
    .string()
    .optional()
    .describe("Why the original scope needs modification"),
});

const RespondTaskInputSchema = z.discriminatedUnion("type", [
  AcceptResponseSchema,
  RejectResponseSchema,
  CounterProposeResponseSchema,
]);

/**
 * Create the task:respond tool.
 *
 * Requires ctx.delegationDeps to be populated (by the worker loop when
 * the agent has task:respond or task:delegate in its tools). Returns a
 * descriptive error if delegation dependencies are not available.
 *
 * @param ctx - Tool context with delegation deps
 * @param waitForState - Optional WaitForState for counter-propose auto-wait (wired by worker loop)
 */
export function createRespondTaskTool(
  ctx: ToolContext,
  waitForState?: WaitForState,
): ToolDefinition {
  return {
    name: "respond_task",
    description:
      "Respond to a delegated task with accept, reject, or counter-propose. " +
      "Accept transitions the task to active and signals the delegator. " +
      "Reject signals the delegator with a reason. " +
      "Counter-propose sends a modified scope/approach to the delegator and " +
      "automatically pauses this conversation to wait for accept/reject. " +
      "Use counter-propose when you can do the work with a different scope, " +
      "reject only for genuine capability mismatches.",
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

      const { type, taskId } = parsed.data;

      try {
        // c. Get the delegated task
        const task = await deps.taskService.get(taskId);
        if (!task) {
          return {
            content: `Task not found: ${taskId}`,
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
          if (type === "accept") {
            await deps.taskService.update(taskId, {
              status: "active",
            });
          }

          if (type === "counter_propose") {
            // Can't counter-propose if delegator is gone -- reject is more appropriate
            return {
              content:
                "Delegator conversation not found (may have timed out or completed). " +
                "Cannot counter-propose without a delegator to negotiate with.",
              isError: true,
            };
          }

          return {
            content:
              "Delegator conversation not found (may have timed out or completed). " +
              "Your handshake response has been recorded. If you accepted, proceed " +
              "with the work -- completion signaling will handle result delivery.",
          };
        }

        // e. Handle counter_propose
        if (type === "counter_propose") {
          // a. Transition task to counter_proposed
          await deps.taskService.update(taskId, { status: "counter_proposed" });

          // b. Build counter-proposal signal with self-contained payload
          const counterSignal: Signal = {
            type: "task_counter_proposed",
            data: {
              taskId,
              proposal: parsed.data.proposal,
              ...(parsed.data.reason && { reason: parsed.data.reason }),
              originalDescription: task.objective ?? task.title,
              respondedBy: ctx.agentId,
            },
            message: `Counter-proposal for task ${taskId}: ${parsed.data.proposal}`,
            source: `agent:${ctx.agentId}`,
            deduplicationId: `counter-propose-${taskId}`,
          };

          // c. Send signal to delegator
          const result = await deps.executor.signal(
            parentConv.id,
            counterSignal,
          );

          // d. Auto-enter wait_for (asking and waiting is a single operation)
          if (waitForState) {
            waitForState.triggered = true;
            waitForState.waitTypes = ["task_handshake"];
            waitForState.reason = `Waiting for delegator to accept/reject counter-proposal on task ${taskId}`;
            waitForState.timeout = "30s";
            waitForState.metadata = { taskId };
            waitForState.timeoutSignalType = "task_handshake";
          }

          return {
            content:
              `Counter-proposal sent for task ${taskId}. Signal delivery: ${result.action}. ` +
              `Proposal: "${parsed.data.proposal}". ` +
              `Conversation paused -- waiting for delegator to accept or reject.`,
          };
        }

        // f. Build signal for accept/reject (self-contained payload)
        const estimate =
          type === "accept"
            ? (parsed.data as { estimate?: string }).estimate
            : undefined;
        const reason =
          type === "reject"
            ? (parsed.data as { reason?: string }).reason
            : undefined;

        const signal: Signal = {
          type: "task_handshake",
          data: {
            taskId,
            response: type,
            ...(estimate && { estimate }),
            ...(reason && { reason }),
            ...(type === "reject" && {
              originalDescription: task.objective ?? task.title,
            }),
            respondedBy: ctx.agentId,
          },
          message:
            type === "accept"
              ? `Delegation accepted for task ${taskId}.${estimate ? ` Estimate: ${estimate}` : ""}`
              : `Delegation rejected for task ${taskId}.${reason ? ` Reason: ${reason}` : ""}`,
          source: `agent:${ctx.agentId}`,
          deduplicationId: `handshake-${taskId}`,
        };

        // g. Send signal to delegator's conversation
        const result = await deps.executor.signal(parentConv.id, signal);

        // h. If accepted, transition task to active
        if (type === "accept") {
          await deps.taskService.update(taskId, {
            status: "active",
          });
        }

        // i. Return success message
        const detail =
          type === "accept"
            ? estimate
              ? ` Estimate: ${estimate}.`
              : ""
            : reason
              ? ` Reason: ${reason}.`
              : "";

        return {
          content: `Handshake ${type} sent for task ${taskId}. Signal delivery: ${result.action}.${detail}`,
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
