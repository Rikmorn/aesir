/**
 * Wait For Task Tool
 *
 * Provides the `wait_for_task` tool that agents use to pause a conversation
 * and wait for a delegated task to complete, fail, or timeout.
 *
 * This is a SEPARATE tool from wait_for with distinct input semantics:
 * - No `type` parameter -- the tool auto-registers for all 3 task lifecycle
 *   signal types: task_completion, task_failure, task_timeout
 * - Requires a `taskId` -- the signal must carry matching taskId in its data
 *   to prevent cross-task signal wakeup
 *
 * Safety by design: agents cannot forget to listen for failure/timeout.
 *
 * Uses the same mutable WaitForState pattern as wait_for -- the executor
 * creates a fresh WaitForState before each loop run and wires it to both
 * wait_for and wait_for_task tools.
 */

import { z } from "zod";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import type { ToolContext, WaitForState } from "./types.js";

// ─── Input Schema ───────────────────────────────────────────────────────────

const WaitForTaskInputSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .describe(
      "ID of the delegated task to wait for. The conversation will resume when " +
        "the task completes, fails, or times out.",
    ),
  timeout: z
    .string()
    .optional()
    .describe(
      "Max time to wait for the task. Format: '<number><unit>' where unit is h (hours) or d (days). " +
        "E.g., '24h', '7d'. If omitted, waits indefinitely.",
    ),
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a wait_for_task tool that sets a mutable WaitForState when called.
 *
 * The executor creates a fresh WaitForState before each loop run and
 * passes it here. After the loop exits, the executor checks
 * `waitForState.triggered` to decide whether to pause the conversation.
 *
 * @param waitForState - Mutable state object shared with the executor
 * @param ctx - Optional ToolContext for auto-acceptance of counter-proposals
 * @returns ToolDefinition for the wait_for_task tool
 */
export function createWaitForTaskTool(
  waitForState: WaitForState,
  ctx?: ToolContext,
): ToolDefinition {
  return {
    name: "wait_for_task",
    description:
      "Pause this conversation and wait for a delegated task to complete. " +
      "Automatically listens for task completion, failure, timeout, clarification, " +
      "and counter-proposal signals. If the task was counter-proposed, calling this " +
      "tool accepts the modified scope and resumes the target agent. " +
      "Use after calling delegate_task to wait for the delegated agent's result.",
    inputSchema: WaitForTaskInputSchema,
    async execute(
      input: unknown,
    ): Promise<{ content: string; isError?: boolean }> {
      const parsed = WaitForTaskInputSchema.parse(input);

      // Auto-accept counter-proposals: when delegator calls wait_for_task on a
      // counter_proposed task, that implicitly accepts the modified scope.
      if (ctx?.delegationDeps) {
        const task = await ctx.delegationDeps.taskService.get(parsed.taskId);
        if (task?.status === "counter_proposed") {
          // Find target's conversation and send acceptance
          const targetConv =
            await ctx.delegationDeps.executor.findActiveForTask(parsed.taskId);
          if (targetConv) {
            await ctx.delegationDeps.executor.signal(targetConv.id, {
              type: "task_handshake",
              data: {
                taskId: parsed.taskId,
                response: "accepted",
                acceptedBy: ctx.agentId,
              },
              message: `Counter-proposal accepted for task ${parsed.taskId}`,
              source: `agent:${ctx.agentId}`,
              deduplicationId: `handshake-accept-${parsed.taskId}`,
            });
          }
          // Transition task to active
          await ctx.delegationDeps.taskService.update(parsed.taskId, {
            status: "active",
          });
        }
      }

      // Set mutable state for executor interception
      waitForState.triggered = true;
      waitForState.waitTypes = [
        "task_completion",
        "task_failure",
        "task_timeout",
        "task_clarification",
        "task_counter_proposed",
      ];
      waitForState.reason = `Waiting for delegated task ${parsed.taskId}`;
      waitForState.timeout = parsed.timeout ?? null;
      waitForState.metadata = { taskId: parsed.taskId };
      waitForState.timeoutSignalType = "task_timeout";

      // Build confirmation message for the LLM
      let message = `Conversation paused. Waiting for task ${parsed.taskId} to complete, fail, timeout, or send a clarification/counter-proposal.`;
      if (parsed.timeout) {
        message += ` Timeout: ${parsed.timeout}.`;
      }

      return { content: message };
    },
  };
}
