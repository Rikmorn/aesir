/**
 * PR Approval Workflow
 *
 * Orchestrates the complete approval flow:
 * 1. Run Dev Agent to create PR
 * 2. Send Slack notification for review
 * 3. Wait for approval signal (with timeout)
 * 4. On approval: merge PR and update Linear
 * 5. On rejection: update Linear status
 * 6. On changes requested: re-run dev workflow with feedback
 *
 * The workflow survives process restarts and can wait indefinitely
 * for human approval (up to configured timeout).
 */

import * as wf from "@temporalio/workflow";
import { proxyActivities } from "@temporalio/workflow";
import type { IssueStatus } from "../../integrations/linear/types.js";
// Import BoundActivities type for properly typed activity proxies
import type { BoundActivities } from "../activities/index.js";
import { approvalSignal, changesRequestedSignal } from "../signals.js";
import type { ApprovalDecision, ChangesRequested } from "../types.js";

/**
 * Workflow input configuration
 */
export interface ApprovalWorkflowInput {
  /** Linear task ID (Issue ID) */
  taskId: string;
  /** Linear AgentSession ID (for emitting activities) */
  sessionId: string;
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Slack channel ID for notifications */
  slackChannel: string;
  /** Linear status to set after successful merge (configurable per project) */
  completionStatus: IssueStatus;
  /** Days to wait for approval before timeout (default: 7) */
  approvalTimeoutDays?: number;
  /** Max iterations for changes-requested feedback loop (default: 3) */
  maxFeedbackIterations?: number;
}

/**
 * Workflow result
 */
export interface ApprovalWorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** PR number if PR was created (undefined if PR creation failed) */
  prNumber: number | undefined;
  /** Outcome of the workflow */
  outcome: "approved" | "rejected" | "timeout" | "failed";
  /** Additional details or error message */
  message?: string;
}

/**
 * Status for approval queries
 */
export interface ApprovalQueryStatus {
  /** Linear task ID */
  taskId: string;
  /** PR number if created (undefined if not yet created) */
  prNumber: number | undefined;
  /** Current workflow status */
  status:
    | "pending"
    | "running"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "timeout";
  /** The decision if one has been made */
  decision: ApprovalDecision | null;
}

// Configure activities with appropriate timeouts
// Activities are bound with dependencies at worker startup via makeActivities()
// The BoundActivities type reflects the simplified signatures without client params
const {
  executeDevWorkflow,
  mergePRActivity,
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
  updateLinearStatusActivity,
} = proxyActivities<BoundActivities>({
  startToCloseTimeout: "30 minutes", // Dev workflow can take a while
  retry: {
    maximumAttempts: 3,
    initialInterval: "1 second",
    backoffCoefficient: 2,
  },
});

// Query for checking approval status
export const approvalStatusQuery =
  wf.defineQuery<ApprovalQueryStatus>("approvalStatus");

/**
 * PR Approval Workflow
 *
 * Orchestrates the complete approval flow from dev agent execution
 * through human review to final merge or rejection.
 *
 * Key behaviors:
 * - Runs dev agent to create PR
 * - Sends Slack notification for review
 * - Waits for approval signal with configurable timeout
 * - Handles approval (merge), rejection, or changes requested
 * - Changes requested triggers feedback loop (up to max iterations)
 * - Completion status is configurable via workflow input
 *
 * @param input - Workflow configuration
 * @returns Workflow result with outcome and optional PR number
 */
export async function prApprovalWorkflow(
  input: ApprovalWorkflowInput,
): Promise<ApprovalWorkflowResult> {
  const {
    taskId,
    sessionId,
    owner,
    repo,
    slackChannel,
    completionStatus,
    approvalTimeoutDays = 7,
    maxFeedbackIterations = 3,
  } = input;

  // Workflow state - use mutable references for signal handlers
  const state = {
    decision: null as ApprovalDecision | null,
    changesRequested: null as ChangesRequested | null,
    prNumber: undefined as number | undefined,
    currentStatus: "pending" as ApprovalQueryStatus["status"],
  };

  // Set up signal handlers
  wf.setHandler(approvalSignal, (signalInput: ApprovalDecision) => {
    wf.log.info("Received approval decision", {
      approved: signalInput.approved,
      reviewer: signalInput.reviewer,
    });
    state.decision = signalInput;
  });

  wf.setHandler(changesRequestedSignal, (signalInput: ChangesRequested) => {
    wf.log.info("Received changes requested", {
      reviewer: signalInput.reviewer,
    });
    state.changesRequested = signalInput;
  });

  // Query handler for status checks
  wf.setHandler(
    approvalStatusQuery,
    (): ApprovalQueryStatus => ({
      taskId,
      prNumber: state.prNumber,
      status: state.currentStatus,
      decision: state.decision,
    }),
  );

  // Feedback loop for changes requested
  let feedbackIteration = 0;

  while (feedbackIteration < maxFeedbackIterations) {
    feedbackIteration++;

    // Step 1: Run Dev Agent workflow
    state.currentStatus = "running";
    wf.log.info(`Running dev workflow (iteration ${feedbackIteration})`);

    try {
      // Dependencies are bound at worker startup via makeActivities()
      // Pass both taskId (issue) and sessionId (for agent activities)
      const devResult = await executeDevWorkflow(taskId, sessionId);

      if (!devResult.success || devResult.prNumber === undefined) {
        wf.log.error("Dev workflow failed to create PR", {
          error: devResult.error,
        });
        return {
          success: false,
          prNumber: undefined,
          outcome: "failed",
          message: devResult.error ?? "Dev workflow failed to create PR",
        };
      }

      state.prNumber = devResult.prNumber;
    } catch (error) {
      wf.log.error("Dev workflow threw error", { error });
      return {
        success: false,
        prNumber: undefined,
        outcome: "failed",
        message: error instanceof Error ? error.message : "Dev workflow failed",
      };
    }

    const prUrl = `https://github.com/${owner}/${repo}/pull/${state.prNumber}`;

    // Step 2: Send Slack notification for review
    state.currentStatus = "awaiting_approval";
    wf.log.info("Sending approval request notification");

    try {
      // Bound activity - no client param needed
      await sendApprovalRequestActivity(
        {
          type: "approval_needed",
          taskId,
          title: `PR #${state.prNumber} ready for review`,
          summary: `Dev Agent completed task ${taskId}`,
          prUrl,
        },
        slackChannel,
      );
    } catch (error) {
      wf.log.warn("Failed to send Slack notification", { error });
      // Continue - notification failure shouldn't block the workflow
    }

    // Step 3: Wait for signal OR timeout
    wf.log.info(`Waiting for approval (timeout: ${approvalTimeoutDays} days)`);

    // Reset for this iteration
    state.decision = null;
    state.changesRequested = null;

    const receivedSignal = await wf.condition(
      () => state.decision !== null || state.changesRequested !== null,
      `${approvalTimeoutDays} days`,
    );

    // Check what happened
    if (!receivedSignal) {
      // Timeout - no signal received
      wf.log.warn("Approval timed out");
      state.currentStatus = "timeout";

      // Send timeout notification
      try {
        await sendStatusUpdateActivity(
          {
            type: "status_update",
            taskId,
            status: "failed",
            details: `Approval timed out after ${approvalTimeoutDays} days`,
          },
          slackChannel,
        );
      } catch {
        // Ignore notification errors
      }

      // Ensure all signal handlers complete before returning
      await wf.condition(wf.allHandlersFinished);

      return {
        success: false,
        prNumber: state.prNumber,
        outcome: "timeout",
        message: `Approval timed out after ${approvalTimeoutDays} days`,
      };
    }

    // Process signals - use non-null assertions after the condition check
    // TypeScript struggles with narrowing object properties in loops
    if (state.changesRequested !== null) {
      // Changes requested - loop back
      const changes: ChangesRequested = state.changesRequested;
      wf.log.info(
        `Changes requested by ${changes.reviewer}, iteration ${feedbackIteration}`,
      );
      state.currentStatus = "running";
    } else if (state.decision !== null) {
      const decision: ApprovalDecision = state.decision;
      if (decision.approved) {
        // Step 4a: Approved - merge PR and update Linear
        wf.log.info(`PR approved by ${decision.reviewer}`);
        state.currentStatus = "approved";

        try {
          // Bound activity - no octokit param needed
          await mergePRActivity({
            owner,
            repo,
            pullNumber: state.prNumber,
            mergeMethod: "squash",
          });
        } catch (error) {
          wf.log.error("Failed to merge PR", { error });
          return {
            success: false,
            prNumber: state.prNumber,
            outcome: "failed",
            message: `Failed to merge PR: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        // Update Linear to configurable completion status
        try {
          // Bound activity - no linear client param needed
          await updateLinearStatusActivity(taskId, completionStatus);
        } catch (error) {
          wf.log.warn("Failed to update Linear status", { error });
          // Continue - Linear update failure shouldn't fail the workflow
        }

        // Send success notification
        try {
          await sendStatusUpdateActivity(
            {
              type: "status_update",
              taskId,
              status: "completed",
              details: `PR #${state.prNumber} merged by ${decision.reviewer}`,
            },
            slackChannel,
          );
        } catch {
          // Ignore notification errors
        }

        // Ensure all signal handlers complete before returning
        await wf.condition(wf.allHandlersFinished);

        return {
          success: true,
          prNumber: state.prNumber,
          outcome: "approved",
          message: `PR merged by ${decision.reviewer}`,
        };
      } else {
        // Step 4b: Rejected
        wf.log.info(`PR rejected by ${decision.reviewer}: ${decision.comment}`);
        state.currentStatus = "rejected";

        // Update Linear back to Ready on rejection
        try {
          await updateLinearStatusActivity(taskId, "Ready");
        } catch (error) {
          wf.log.warn("Failed to update Linear status on rejection", { error });
        }

        // Send rejection notification
        try {
          await sendStatusUpdateActivity(
            {
              type: "status_update",
              taskId,
              status: "failed",
              details: decision.comment ?? `Rejected by ${decision.reviewer}`,
            },
            slackChannel,
          );
        } catch {
          // Ignore notification errors
        }

        // Ensure all signal handlers complete before returning
        await wf.condition(wf.allHandlersFinished);

        return {
          success: false,
          prNumber: state.prNumber,
          outcome: "rejected",
          message: decision.comment ?? `Rejected by ${decision.reviewer}`,
        };
      }
    }
  }

  // Exceeded max feedback iterations
  wf.log.warn(`Max feedback iterations (${maxFeedbackIterations}) exceeded`);

  // Send failure notification
  try {
    await sendStatusUpdateActivity(
      {
        type: "status_update",
        taskId,
        status: "failed",
        details: `Max feedback iterations (${maxFeedbackIterations}) exceeded`,
      },
      slackChannel,
    );
  } catch {
    // Ignore notification errors
  }

  // Ensure all signal handlers complete before returning
  await wf.condition(wf.allHandlersFinished);

  return {
    success: false,
    prNumber: state.prNumber,
    outcome: "failed",
    message: `Max feedback iterations (${maxFeedbackIterations}) exceeded`,
  };
}
