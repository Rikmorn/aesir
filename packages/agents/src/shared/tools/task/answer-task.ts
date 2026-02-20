/**
 * task:answer Tool Factory
 *
 * Sends a clarification answer from the delegator back to the target agent.
 * Automatically re-enters wait_for_task after answering, preventing the
 * CRITICAL-1 deadlock where a completion signal arrives but the delegator
 * is not listening for the right signal types.
 *
 * Flow: delegator calls answer -> sends task_clarification_response signal
 *       to target -> delegator auto-pauses waiting for all 5 delegation
 *       signal types (completion, failure, timeout, clarification,
 *       counter_proposed)
 */

import { z } from "zod";
import type {
  Signal,
  ToolContext,
  WaitForState,
} from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

const AnswerTaskInputSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .describe("The task ID that sent the clarification question"),
  answer: z
    .string()
    .min(1)
    .describe("Your answer to the clarification question"),
});

/**
 * Create the task:answer tool.
 *
 * Requires ctx.delegationDeps to be populated (by the worker loop when
 * the agent has task:answer in its tools). Returns a descriptive error
 * if delegation dependencies are not available.
 *
 * @param ctx - Tool context with delegation deps
 * @param waitForState - Optional WaitForState for auto-re-enter wait_for_task (wired by worker loop)
 */
export function createAnswerTaskTool(
  ctx: ToolContext,
  waitForState?: WaitForState,
): ToolDefinition {
  return {
    name: "answer_task",
    description:
      "Answer a clarification question from a delegated agent. Sends your answer " +
      "and automatically re-enters wait_for_task to continue listening for the " +
      "task's completion, failure, or further clarifications. " +
      "Use when a delegated agent asks a clarification question during task execution.",
    inputSchema: AnswerTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      // a. Check delegationDeps exists
      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for answering clarifications.",
          isError: true,
        };
      }

      // b. Parse and validate input
      const parsed = AnswerTaskInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        // c. Find the target's conversation (the agent WORKING on this task)
        const targetConv = await deps.executor.findActiveForTask(
          parsed.data.taskId,
        );

        if (!targetConv) {
          return {
            content:
              "Target agent conversation not found. The agent may have timed out.",
            isError: true,
          };
        }

        // d. Build the task_clarification_response signal
        const signal: Signal = {
          type: "task_clarification_response",
          data: {
            taskId: parsed.data.taskId,
            answer: parsed.data.answer,
            answeredBy: ctx.agentId,
          },
          message: `Clarification answer for task ${parsed.data.taskId}: ${parsed.data.answer}`,
          source: `agent:${ctx.agentId}`,
          // Timestamp in deduplicationId because the same task can have
          // multiple clarification rounds. Each round is a distinct signal.
          deduplicationId: `clarify-answer-${parsed.data.taskId}-${Date.now()}`,
        };

        // e. Send signal to target's conversation
        await deps.executor.signal(targetConv.id, signal);

        // f. Auto-re-enter wait_for_task (CRITICAL for deadlock prevention)
        // This mirrors exactly what wait_for_task does. The delegator is
        // paused listening for all delegation signals, preventing the
        // CRITICAL-1 deadlock where a completion signal arrives but the
        // delegator is waiting for the wrong type.
        if (waitForState) {
          waitForState.triggered = true;
          waitForState.waitTypes = [
            "task_completion",
            "task_failure",
            "task_timeout",
            "task_clarification",
            "task_counter_proposed",
          ];
          waitForState.reason = `Waiting for delegated task ${parsed.data.taskId} after answering clarification`;
          waitForState.timeout = null;
          waitForState.metadata = { taskId: parsed.data.taskId };
          waitForState.timeoutSignalType = "task_timeout";
        }

        return {
          content:
            "Answer sent. Conversation paused -- waiting for task to complete or send further clarifications.",
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to answer clarification: ${message}`,
          isError: true,
        };
      }
    },
  };
}
