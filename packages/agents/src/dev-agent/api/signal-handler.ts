/**
 * Signal Handler for Dev Agent Events
 *
 * Sends Temporal signals from HTTP event handlers.
 * Bridges external events (Slack buttons, GitHub PRs, Linear comments)
 * to the dev-agent Temporal workflow.
 *
 * Key behaviors:
 * - sendApprovalSignal: Signals plan approval/rejection from any source
 * - sendCompletionSignal: Handles PR completion events
 * - Graceful handling of workflow-not-found errors
 */

import type { PinoLogger } from "@aesir/common";
import type { Client as TemporalClient } from "@temporalio/client";
import {
  planApprovalSignal,
  prCompletionSignal,
} from "../../temporal/signals.js";

/**
 * Dependencies for signal handler functions
 */
export interface SignalHandlerDeps {
  /** Temporal client for sending signals to workflows */
  workflowClient: TemporalClient;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * Input for approval signal
 */
export interface ApprovalSignalInput {
  /** Task identifier (e.g., "ABC-123" or Linear issue ID) */
  taskIdentifier: string;
  /** UUID if known (preferred for workflow lookup) */
  taskId?: string;
  /** Whether the plan was approved */
  approved: boolean;
  /** Feedback explaining rejection or concerns */
  feedback?: string;
  /** User ID of the approver */
  approverUserId?: string;
  /** Display name of the approver */
  approverName?: string;
  /** Source channel of the approval */
  source?: "slack" | "linear";
  /** Slack channel (for logging/tracking) */
  channel?: string;
}

/**
 * Result of signal operation
 */
export interface SignalResult {
  /** Whether the signal was sent successfully */
  signaled: boolean;
  /** Workflow ID that received the signal */
  workflowId?: string;
  /** Error message if signal failed */
  error?: string;
}

/**
 * Input for completion signal
 */
export interface CompletionSignalInput {
  /** PR number */
  prNumber: number;
  /** Whether the PR was merged (vs closed without merge) */
  merged: boolean;
  /** Branch name (used to extract task identifier) */
  branchName: string;
  /** Repository information */
  repository: { owner: string; name: string };
  /** UUID if known (preferred for workflow lookup) */
  taskId?: string;
}

/**
 * Send approval signal to a dev-agent workflow.
 *
 * Looks up the workflow by task ID and sends a planApprovalSignal.
 * Handles workflow-not-found gracefully (logs warning, returns error).
 *
 * @param deps - Signal handler dependencies
 * @param input - Approval signal input
 * @returns Result indicating success/failure
 */
export async function sendApprovalSignal(
  deps: SignalHandlerDeps,
  input: ApprovalSignalInput,
): Promise<SignalResult> {
  const { workflowClient, logger } = deps;

  // Workflow ID format: dev-agent-{issueUUID}
  // Problem: We may have identifier (ABC-123) but need UUID
  // Solution: If taskId provided, use it directly; otherwise use identifier
  const workflowId = input.taskId
    ? `dev-agent-${input.taskId}`
    : `dev-agent-${input.taskIdentifier}`;

  const signalLogger = logger.child({
    action: "sendApprovalSignal",
    workflowId,
    taskIdentifier: input.taskIdentifier,
    approved: input.approved,
  });

  try {
    const handle = workflowClient.workflow.getHandle(workflowId);

    // Build signal payload - only include optional fields if defined
    // Uses spread pattern for exactOptionalPropertyTypes compatibility
    const signalPayload = {
      approved: input.approved,
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
      ...(input.approverName !== undefined
        ? { approverName: input.approverName }
        : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
    };

    await handle.signal(planApprovalSignal, signalPayload);

    signalLogger.info("Approval signal sent");
    return { signaled: true, workflowId };
  } catch (error) {
    // Check if workflow not found
    const isNotFound =
      error instanceof Error &&
      (error.message.includes("not found") ||
        error.message.includes("WorkflowNotFoundError") ||
        error.name === "WorkflowNotFoundError");

    if (isNotFound) {
      signalLogger.warn("Workflow not found for approval signal");
      return { signaled: false, error: "Workflow not found" };
    }

    signalLogger.error({ err: error }, "Failed to send approval signal");
    throw error;
  }
}

/**
 * Send completion signal for PR merge/close events.
 *
 * Extracts task identifier from branch name and sends prCompletionSignal
 * to the associated dev-agent workflow.
 *
 * @param deps - Signal handler dependencies
 * @param input - Completion signal input
 * @returns Result indicating success/failure
 */
export async function sendCompletionSignal(
  deps: SignalHandlerDeps,
  input: CompletionSignalInput,
): Promise<SignalResult> {
  const { workflowClient, logger } = deps;

  const completionLogger = logger.child({
    action: "sendCompletionSignal",
    prNumber: input.prNumber,
    merged: input.merged,
    branchName: input.branchName,
    repository: `${input.repository.owner}/${input.repository.name}`,
  });

  // Extract task identifier from branch name
  // Branch format: feature/{identifier} (e.g., feature/ABC-123)
  const branchMatch = input.branchName.match(/feature\/([A-Z]+-\d+)/i);

  if (!branchMatch) {
    completionLogger.warn("Cannot extract task ID from branch name");
    return { signaled: false, error: "Cannot identify task from branch name" };
  }

  const taskIdentifier = branchMatch[1];

  // Workflow ID format: dev-agent-{identifier}
  // Note: If workflow was created with UUID, this may not match.
  // For task ID lookup, the event handler should provide taskId if available.
  const workflowId = input.taskId
    ? `dev-agent-${input.taskId}`
    : `dev-agent-${taskIdentifier}`;

  completionLogger.info(
    { taskIdentifier, workflowId },
    `Processing PR completion (${input.merged ? "merged" : "closed"})`,
  );

  try {
    const handle = workflowClient.workflow.getHandle(workflowId);

    // Build signal payload - include optional branchName for context
    const signalPayload = {
      merged: input.merged,
      prNumber: input.prNumber,
      ...(input.branchName !== undefined
        ? { branchName: input.branchName }
        : {}),
    };

    await handle.signal(prCompletionSignal, signalPayload);

    completionLogger.info("PR completion signal sent");
    return { signaled: true, workflowId };
  } catch (error) {
    // Check if workflow not found
    const isNotFound =
      error instanceof Error &&
      (error.message.includes("not found") ||
        error.message.includes("WorkflowNotFoundError") ||
        error.name === "WorkflowNotFoundError");

    if (isNotFound) {
      completionLogger.warn(
        "Workflow not found for PR completion signal - PR may not be associated with a dev-agent task",
      );
      return { signaled: false, error: "Workflow not found" };
    }

    completionLogger.error(
      { err: error },
      "Failed to send PR completion signal",
    );
    throw error;
  }
}
