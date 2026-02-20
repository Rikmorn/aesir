/**
 * task:clarify Tool Factory
 *
 * Sends a clarification question from the target agent back to the delegating
 * agent. Automatically pauses this conversation until the delegator answers.
 *
 * Use when the target agent needs to understand the delegator's intent before
 * proceeding -- for example, when a requirement is ambiguous and the wrong
 * assumption would waste significant work.
 *
 * Flow: target calls clarify -> sends task_clarification signal to delegator
 *       -> target auto-pauses waiting for task_clarification_response
 */

import { z } from "zod";
import type {
  Signal,
  ToolContext,
  WaitForState,
} from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

const ClarifyTaskInputSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to clarify"),
  question: z
    .string()
    .min(1)
    .describe("The clarification question for the delegator"),
  options: z
    .array(z.string())
    .optional()
    .describe(
      "Optional structured choices when the question has discrete answers (e.g., ['OAuth', 'JWT', 'Session-based'])",
    ),
});

/**
 * Create the task:clarify tool.
 *
 * Requires ctx.delegationDeps to be populated (by the worker loop when
 * the agent has task:clarify in its tools). Returns a descriptive error
 * if delegation dependencies are not available.
 *
 * @param ctx - Tool context with delegation deps
 * @param waitForState - Optional WaitForState for auto-pause (wired by worker loop)
 */
export function createClarifyTaskTool(
  ctx: ToolContext,
  waitForState?: WaitForState,
): ToolDefinition {
  return {
    name: "clarify_task",
    description:
      "Send a clarification question back to the delegating agent. " +
      "Automatically pauses this conversation until the delegator answers. " +
      "Use when you need to understand the delegator's intent before proceeding -- " +
      "for example, when a requirement is ambiguous and the wrong assumption " +
      "would waste significant work. Provide structured options when the " +
      "question has discrete answers to help the delegator respond quickly.",
    inputSchema: ClarifyTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      // a. Check delegationDeps exists
      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for clarification requests.",
          isError: true,
        };
      }

      // b. Parse and validate input
      const parsed = ClarifyTaskInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      try {
        // c. Get the task and verify it has a parent
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
              "This task has no parent -- nothing to clarify with. This tool is for clarifying delegated tasks.",
            isError: true,
          };
        }

        // d. Find the delegator's active conversation
        const parentConv = await deps.executor.findActiveForTask(
          task.parent_id,
        );

        if (!parentConv) {
          return {
            content:
              "Delegator conversation not found. Cannot send clarification without an active delegator.",
            isError: true,
          };
        }

        // e. Build the task_clarification signal
        const signal: Signal = {
          type: "task_clarification",
          data: {
            taskId: parsed.data.taskId,
            question: parsed.data.question,
            ...(parsed.data.options && { options: parsed.data.options }),
            respondedBy: ctx.agentId,
          },
          message: `Clarification needed for task ${parsed.data.taskId}: ${parsed.data.question}`,
          source: `agent:${ctx.agentId}`,
          // Timestamp in deduplicationId because the same task can have
          // multiple clarification rounds. Each round is a distinct signal.
          deduplicationId: `clarify-${parsed.data.taskId}-${Date.now()}`,
        };

        // f. Send signal to delegator
        await deps.executor.signal(parentConv.id, signal);

        // g. Auto-enter wait_for (asking and waiting is a single logical operation)
        if (waitForState) {
          waitForState.triggered = true;
          waitForState.waitTypes = ["task_clarification_response"];
          waitForState.reason = `Waiting for clarification answer on task ${parsed.data.taskId}`;
          waitForState.timeout = null; // Task timeout is the universal bound
          waitForState.metadata = { taskId: parsed.data.taskId };
        }

        return {
          content:
            "Clarification sent. Conversation paused until delegator responds.",
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `Failed to send clarification: ${message}`,
          isError: true,
        };
      }
    },
  };
}
