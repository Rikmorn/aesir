/**
 * Signal Workflow Tool
 *
 * Router tool that sends a named signal to an existing Temporal workflow.
 * Maps signal name strings to imported signal definition objects from
 * shared/temporal/signals.ts.
 *
 * Handles WorkflowNotFoundError gracefully -- the target workflow may
 * have already completed or been terminated.
 */

import { z } from "zod";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import {
  cancelConversationSignal,
  escalationResolvedSignal,
  planApprovalSignal,
  prCompletionSignal,
  prFeedbackSignal,
  userReplySignal,
} from "../../shared/temporal/signals.js";
import type { RouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const SignalWorkflowInputSchema = z.object({
  workflowId: z
    .string()
    .describe("Workflow ID to signal (e.g., 'dev-agent-{issueId}')"),
  signal: z
    .enum([
      "planApproval",
      "prFeedback",
      "escalationResolved",
      "prCompletion",
      "userReply",
      "cancelConversation",
    ])
    .describe("Signal name to send"),
  payload: z
    .unknown()
    .optional()
    .describe("Signal payload (varies by signal type)"),
});

// ---------------------------------------------------------------------------
// Signal Name -> Definition Mapping
// ---------------------------------------------------------------------------

/**
 * Maps signal name strings from the LLM to imported Temporal signal definitions.
 * Each signal definition carries the correct signal name for the Temporal runtime.
 */
const SIGNAL_MAP = {
  planApproval: planApprovalSignal,
  prFeedback: prFeedbackSignal,
  escalationResolved: escalationResolvedSignal,
  prCompletion: prCompletionSignal,
  userReply: userReplySignal,
  cancelConversation: cancelConversationSignal,
} as const;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the signal_workflow tool definition.
 *
 * Maps signal name strings to Temporal signal definitions and sends them
 * to the target workflow. cancelConversation takes no payload; all others
 * pass the payload through.
 *
 * @param deps - Router dependencies (needs workflowClient)
 * @returns ToolDefinition for the agent loop
 */
export function createSignalWorkflowTool(deps: RouterDeps): ToolDefinition {
  return {
    name: "signal_workflow",
    description:
      "Send a signal to an existing Temporal workflow. Use planApproval for approvals/rejections, prFeedback for PR reviews, escalationResolved for stuck task guidance, prCompletion for PR merge/close, userReply for thread replies, cancelConversation for conversation cancellation.",
    inputSchema: SignalWorkflowInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = SignalWorkflowInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { workflowId, signal, payload } = parsed.data;
      const signalDef = SIGNAL_MAP[signal];

      try {
        const handle = deps.workflowClient.workflow.getHandle(workflowId);

        // Send the signal using the definition's name string.
        // cancelConversation takes no args; all others pass the payload.
        // We use the string form of handle.signal() to avoid TypeScript
        // narrowing issues with the union of all signal definition types.
        if (signal === "cancelConversation") {
          await handle.signal(cancelConversationSignal);
        } else {
          await handle.signal(signalDef.name, payload);
        }

        deps.logger.info(
          { workflowId, signal },
          "signal_workflow: signal sent",
        );

        return {
          content: JSON.stringify({ signaled: true, workflowId, signal }),
        };
      } catch (error) {
        const isNotFound =
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("WorkflowNotFoundError") ||
            error.name === "WorkflowNotFoundError");

        if (isNotFound) {
          deps.logger.warn(
            { workflowId, signal },
            "signal_workflow: workflow not found",
          );
          return {
            content: `Workflow "${workflowId}" not found. It may have already completed or been terminated.`,
            isError: true,
          };
        }

        const message =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error, workflowId, signal },
          "signal_workflow: failed to send signal",
        );
        return {
          content: `Failed to signal workflow: ${message}`,
          isError: true,
        };
      }
    },
  };
}
