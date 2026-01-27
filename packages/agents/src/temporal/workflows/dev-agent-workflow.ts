/**
 * Dev Agent Temporal Workflow
 *
 * Durable workflow that orchestrates the dev-agent LangGraph graph.
 * Handles:
 * - Plan approval signals (from Linear or Slack)
 * - PR feedback signals (from GitHub review)
 * - Escalation resolution signals (from human)
 * - Timeouts (24h container stop, 72h total)
 *
 * The LangGraph graph handles reasoning; Temporal handles durability,
 * signals, and timeouts. Graph ends at approval/feedback points,
 * Temporal waits for signals to continue.
 */

import * as wf from "@temporalio/workflow";
import { proxyActivities } from "@temporalio/workflow";

import {
  escalationResolvedSignal,
  type PlanApprovalPayload,
  planApprovalSignal,
  prFeedbackSignal,
} from "../signals.js";
import type {
  DevAgentWorkflowInput,
  DevAgentWorkflowPhase,
  DevAgentWorkflowResult,
} from "../types.js";

/**
 * Activity types for this workflow.
 * Activities are defined in dev-agent-activities.ts and bound at worker startup.
 */
interface DevAgentActivities {
  runDevAgentGraphActivity: (input: {
    taskId: string;
    issue: DevAgentWorkflowInput["issue"];
    slackChannel: string;
    startPhase?: string;
  }) => Promise<{
    phase: string;
    prNumber?: number;
    prUrl?: string;
    errorMessage?: string;
    slackMessageTs?: string;
  }>;

  continueAfterApprovalActivity: (input: {
    taskId: string;
    issue: DevAgentWorkflowInput["issue"];
    slackChannel: string;
  }) => Promise<{
    phase: string;
    prNumber?: number;
    prUrl?: string;
    errorMessage?: string;
    slackMessageTs?: string;
  }>;

  handlePRFeedbackActivity: (input: {
    taskId: string;
    issue: DevAgentWorkflowInput["issue"];
    slackChannel: string;
    feedback: string;
  }) => Promise<{
    phase: string;
    errorMessage?: string;
  }>;

  stopContainerActivity: (taskId: string) => Promise<void>;

  sendReminderActivity: (input: {
    taskId: string;
    slackChannel: string;
    message: string;
  }) => Promise<void>;

  updateSlackApprovalActivity: (input: {
    slackChannel: string;
    slackMessageTs: string;
    approverName: string;
    approved: boolean;
    estimatedTime?: string;
  }) => Promise<void>;

  syncApprovalToLinearActivity: (input: {
    issueId: string;
    approverName: string;
    approved: boolean;
    source: "slack" | "linear";
  }) => Promise<void>;

  handleRePlanActivity: (input: {
    taskId: string;
    issue: DevAgentWorkflowInput["issue"];
    slackChannel: string;
    feedback: string;
  }) => Promise<{
    phase: string;
    prNumber?: number;
    prUrl?: string;
    errorMessage?: string;
    slackMessageTs?: string;
  }>;
}

// Configure activities with appropriate timeouts
const {
  runDevAgentGraphActivity,
  continueAfterApprovalActivity,
  handlePRFeedbackActivity,
  stopContainerActivity,
  sendReminderActivity,
  updateSlackApprovalActivity,
  syncApprovalToLinearActivity,
  handleRePlanActivity,
} = proxyActivities<DevAgentActivities>({
  startToCloseTimeout: "30 minutes", // LLM + container ops can take time
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

// Timeouts (from context decisions: 24h/72h pattern)
const APPROVAL_TIMEOUT = "24 hours";
const REMINDER_WAIT = "48 hours"; // Additional wait after reminder (72h total)
const FEEDBACK_TIMEOUT = "7 days"; // Wait for PR review feedback

/**
 * Query for checking workflow status
 */
export interface DevAgentQueryStatus {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Current workflow phase */
  phase: DevAgentWorkflowPhase;
  /** PR number if created */
  prNumber?: number | undefined;
  /** PR URL if created */
  prUrl?: string | undefined;
  /** Error message if any */
  errorMessage?: string | undefined;
}

export const devAgentStatusQuery =
  wf.defineQuery<DevAgentQueryStatus>("devAgentStatus");

/**
 * Dev Agent Workflow
 *
 * Orchestrates the dev-agent LangGraph graph with signal-based flow control.
 *
 * Flow:
 * 1. Run graph until awaiting_approval (research -> plan -> request approval)
 * 2. Wait for approval signal (24h timeout -> stop container, 72h -> workflow timeout)
 * 3. On approval, run graph from executing (execute -> verify -> create PR -> notify)
 * 4. Wait for optional feedback signal (7 days)
 * 5. On feedback, run graph from addressing_feedback
 * 6. Complete or escalate
 *
 * @param input - Workflow input with task, issue, and slack channel
 * @returns Workflow result with success, phase, and optional PR info
 */
export async function devAgentWorkflow(
  input: DevAgentWorkflowInput,
): Promise<DevAgentWorkflowResult> {
  const { taskId, issue, slackChannel } = input;

  // Mutable state for signal handlers
  const state = {
    phase: "pending" as DevAgentWorkflowPhase,
    approval: null as PlanApprovalPayload | null,
    prFeedback: null as string | null,
    escalationResolution: null as {
      action: "retry" | "abort";
      guidance?: string;
    } | null,
    prNumber: undefined as number | undefined,
    prUrl: undefined as string | undefined,
    errorMessage: undefined as string | undefined,
    slackMessageTs: undefined as string | undefined,
  };

  // Signal handlers
  wf.setHandler(planApprovalSignal, (decision) => {
    wf.log.info("Received plan approval signal", {
      approved: decision.approved,
    });
    state.approval = decision;
  });

  wf.setHandler(prFeedbackSignal, (feedback) => {
    wf.log.info("Received PR feedback signal", {
      feedbackLength: feedback.length,
    });
    state.prFeedback = feedback;
  });

  wf.setHandler(escalationResolvedSignal, (resolution) => {
    wf.log.info("Received escalation resolution signal", {
      action: resolution.action,
    });
    state.escalationResolution = resolution;
  });

  // Query handler for status
  wf.setHandler(
    devAgentStatusQuery,
    (): DevAgentQueryStatus => ({
      taskId,
      phase: state.phase,
      prNumber: state.prNumber,
      prUrl: state.prUrl,
      errorMessage: state.errorMessage,
    }),
  );

  // Phase 1: Run graph until approval needed
  wf.log.info("Starting dev-agent workflow", {
    taskId,
    issueIdentifier: issue.identifier,
  });

  let graphResult = await runDevAgentGraphActivity({
    taskId,
    issue,
    slackChannel,
  });

  state.phase = graphResult.phase as DevAgentWorkflowPhase;
  state.prNumber = graphResult.prNumber;
  state.prUrl = graphResult.prUrl;
  state.errorMessage = graphResult.errorMessage;
  state.slackMessageTs = graphResult.slackMessageTs;

  // Handle awaiting_approval
  if (state.phase === "awaiting_approval") {
    wf.log.info("Waiting for plan approval", { taskId });

    // Wait for approval signal with timeout
    const receivedApproval = await wf.condition(
      () => state.approval !== null,
      APPROVAL_TIMEOUT,
    );

    if (!receivedApproval) {
      // 24h timeout - stop container and send reminder
      wf.log.info("Approval timeout (24h), stopping container", { taskId });
      await stopContainerActivity(taskId);
      await sendReminderActivity({
        taskId,
        slackChannel,
        message: `Reminder: Plan for *${issue.identifier}* is waiting for approval. Container has been stopped but can be resumed.`,
      });

      // Wait longer (48h more = 72h total)
      const lateApproval = await wf.condition(
        () => state.approval !== null,
        REMINDER_WAIT,
      );

      if (!lateApproval) {
        // 72h total timeout - end workflow
        state.phase = "timeout";
        await sendReminderActivity({
          taskId,
          slackChannel,
          message: `Plan for *${issue.identifier}* has timed out after 72 hours. Please create a new issue if still needed.`,
        });

        await wf.condition(wf.allHandlersFinished);
        return {
          success: false,
          phase: "timeout",
        };
      }
    }

    // Process approval decision
    if (state.approval) {
      const approverName = state.approval.approverName || "User";
      const approvalSource = state.approval.source || "slack";

      // Update Slack message to show approval status (remove buttons)
      if (slackChannel && state.slackMessageTs) {
        await updateSlackApprovalActivity({
          slackChannel,
          slackMessageTs: state.slackMessageTs,
          approverName,
          approved: state.approval.approved,
          estimatedTime: "5-10 min",
        });
      }

      // Sync approval to Linear if it came from Slack
      await syncApprovalToLinearActivity({
        issueId: issue.id,
        approverName,
        approved: state.approval.approved,
        source: approvalSource,
      });

      if (!state.approval.approved) {
        // Rejection - trigger re-planning if feedback provided
        if (state.approval.feedback) {
          wf.log.info("Plan rejected with feedback, re-planning", {
            feedback: state.approval.feedback,
          });

          graphResult = await handleRePlanActivity({
            taskId,
            issue,
            slackChannel,
            feedback: state.approval.feedback,
          });

          // Reset approval state for next cycle
          state.approval = null;
          state.phase = graphResult.phase as DevAgentWorkflowPhase;
          state.slackMessageTs = graphResult.slackMessageTs;

          // If re-planning puts us back to awaiting_approval, loop back
          // The workflow will handle this in the next iteration
          // For now, return to let Temporal continue the workflow
          if (state.phase === "awaiting_approval") {
            wf.log.info("Revised plan posted, waiting for next approval");
            // Recursive wait for approval - loop back
            const nextApproval = await wf.condition(
              () => state.approval !== null,
              APPROVAL_TIMEOUT,
            );

            if (!nextApproval) {
              // Another 24h timeout on revised plan
              await stopContainerActivity(taskId);
              await sendReminderActivity({
                taskId,
                slackChannel,
                message: `Reminder: Revised plan for *${issue.identifier}* is waiting for approval.`,
              });

              const lateFinalApproval = await wf.condition(
                () => state.approval !== null,
                REMINDER_WAIT,
              );

              if (!lateFinalApproval) {
                state.phase = "timeout";
                await sendReminderActivity({
                  taskId,
                  slackChannel,
                  message: `Revised plan for *${issue.identifier}* has timed out after 72 hours.`,
                });

                await wf.condition(wf.allHandlersFinished);
                return {
                  success: false,
                  phase: "timeout",
                };
              }
            }

            // Process the next approval (simplified - doesn't handle another rejection)
            // For full re-planning loops, this would need recursion or a while loop
            // Type assertion needed because TypeScript doesn't understand wf.condition can change state
            const nextApprovalDecision =
              state.approval as PlanApprovalPayload | null;
            if (nextApprovalDecision && !nextApprovalDecision.approved) {
              wf.log.info("Revised plan also rejected", {
                feedback: nextApprovalDecision.feedback,
              });
              state.phase = "failed";

              await wf.condition(wf.allHandlersFinished);
              return {
                success: false,
                phase: "failed",
                errorMessage: `Revised plan rejected: ${nextApprovalDecision.feedback || "No feedback provided"}`,
              };
            }
          }
        } else {
          // Rejected without feedback - fail gracefully
          wf.log.info("Plan rejected without feedback");
          state.phase = "failed";

          await wf.condition(wf.allHandlersFinished);
          return {
            success: false,
            phase: "failed",
            errorMessage: "Plan rejected without feedback",
          };
        }
      }
    }

    // Approved (either first plan or revised plan) - continue execution
    if (state.approval?.approved) {
      wf.log.info("Plan approved, continuing to execution", { taskId });
      graphResult = await continueAfterApprovalActivity({
        taskId,
        issue,
        slackChannel,
      });

      state.phase = graphResult.phase as DevAgentWorkflowPhase;
      state.prNumber = graphResult.prNumber;
      state.prUrl = graphResult.prUrl;
      state.errorMessage = graphResult.errorMessage;
    }
  }

  // Handle escalation
  if (state.phase === "escalated") {
    wf.log.info("Workflow escalated, waiting for human resolution", { taskId });

    const resolved = await wf.condition(
      () => state.escalationResolution !== null,
      FEEDBACK_TIMEOUT,
    );

    if (!resolved || state.escalationResolution?.action === "abort") {
      await wf.condition(wf.allHandlersFinished);
      return {
        success: false,
        phase: "escalated",
        errorMessage: state.errorMessage,
      };
    }

    // Retry logic could be implemented here in future
    wf.log.info("Escalation resolved, but retry not yet implemented");
    await wf.condition(wf.allHandlersFinished);
    return {
      success: false,
      phase: "escalated",
      errorMessage: "Escalation resolved but automatic retry not implemented",
    };
  }

  // Handle complete (PR created)
  if (state.phase === "complete" && state.prUrl) {
    wf.log.info("Workflow complete, PR created", {
      prNumber: state.prNumber,
      prUrl: state.prUrl,
    });

    // Wait for PR feedback (optional - can receive review comments)
    const receivedFeedback = await wf.condition(
      () => state.prFeedback !== null,
      FEEDBACK_TIMEOUT,
    );

    if (receivedFeedback && state.prFeedback) {
      wf.log.info("Received PR feedback, addressing", { taskId });

      const feedbackResult = await handlePRFeedbackActivity({
        taskId,
        issue,
        slackChannel,
        feedback: state.prFeedback,
      });

      state.phase = feedbackResult.phase as DevAgentWorkflowPhase;

      if (feedbackResult.phase === "escalated") {
        await wf.condition(wf.allHandlersFinished);
        return {
          success: false,
          phase: "escalated",
          errorMessage: feedbackResult.errorMessage,
          prNumber: state.prNumber,
          prUrl: state.prUrl,
        };
      }
    }

    await wf.condition(wf.allHandlersFinished);
    return {
      success: true,
      phase: "complete",
      prNumber: state.prNumber,
      prUrl: state.prUrl,
    };
  }

  // Handle failed
  if (state.phase === "failed") {
    await wf.condition(wf.allHandlersFinished);
    return {
      success: false,
      phase: "failed",
      errorMessage: state.errorMessage,
    };
  }

  // Unexpected state
  wf.log.warn("Workflow ended in unexpected phase", { phase: state.phase });
  await wf.condition(wf.allHandlersFinished);
  return {
    success: false,
    phase: state.phase,
    errorMessage: state.errorMessage || "Unexpected workflow state",
  };
}
