/**
 * Orchestrator Temporal Workflow (v2.2)
 *
 * Simplified workflow that wraps the agentic orchestrator loop in Temporal's
 * durability envelope. Replaces the 694-line legacy dev-agent-workflow.ts
 * with a dramatically simpler structure:
 *
 *   setup -> pre-approval loop -> approval wait -> post-approval -> PR wait -> feedback loop -> complete
 *
 * The orchestrator handles all reasoning, Slack messages, Linear updates, and
 * side effects internally via its tools. This workflow only manages:
 * - Activity invocation with appropriate retry configs
 * - Signal-based flow control (approval gates, PR feedback)
 * - Timeout patterns (24h reminder, 72h approval, 7-day feedback)
 * - While-loop for unlimited rejection/re-planning cycles
 *
 * IMPORTANT: Workflow code must be deterministic for Temporal replay.
 * No imports of activity implementations, no Date.now(), no Math.random().
 */

import * as wf from "@temporalio/workflow";
import { proxyActivities } from "@temporalio/workflow";

import type { PlanApprovalPayload, PRCompletionPayload } from "../signals.js";
import {
  escalationResolvedSignal,
  planApprovalSignal,
  prCompletionSignal,
  prFeedbackSignal,
} from "../signals.js";
import type {
  OrchestratorWorkflowInput,
  OrchestratorWorkflowPhase,
  OrchestratorWorkflowResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Activity Interfaces (for proxyActivities -- cannot import implementations)
// ---------------------------------------------------------------------------

/** Orchestrator activities with long timeout and limited retries */
interface OrchestratorActivities {
  runOrchestratorPreApproval: (input: {
    taskId: string;
    issue: OrchestratorWorkflowInput["issue"];
    slackChannel: string;
    workflowId: string;
    rejectionFeedback?: string;
  }) => Promise<{
    status: string;
    plan: string;
    humanInputRequest: {
      channel: string;
      message: string;
      requestType: "approval" | "clarification" | "escalation";
    } | null;
    toolCallCount: number;
    tokenCount: { input: number; output: number };
  }>;

  runOrchestratorPostApproval: (input: {
    taskId: string;
    issue: OrchestratorWorkflowInput["issue"];
    slackChannel: string;
    workflowId: string;
  }) => Promise<{
    status: string;
    prNumber?: number;
    prUrl?: string;
    errorMessage?: string;
    toolCallCount: number;
    tokenCount: { input: number; output: number };
  }>;

  handleOrchestratorFeedback: (input: {
    taskId: string;
    issue: OrchestratorWorkflowInput["issue"];
    slackChannel: string;
    workflowId: string;
    feedback: string;
  }) => Promise<{
    status: string;
    fixesApplied: boolean;
    errorMessage?: string;
    toolCallCount: number;
    tokenCount: { input: number; output: number };
  }>;
}

/** Infrastructure activities with short timeout and more retries */
interface InfrastructureActivities {
  setupContainerActivity: (input: {
    taskId: string;
    issue: { identifier: string; title: string };
    workflowId: string;
  }) => Promise<{ containerId: string }>;

  stopContainerActivity: (taskId: string) => Promise<void>;

  completeTaskActivity: (input: {
    taskId: string;
    success: boolean;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Activity Proxies (separate configs per research recommendations)
// ---------------------------------------------------------------------------

/** Orchestrator: 45min timeout (agentic loops are expensive), 2 retries, heartbeat */
const orchestratorActivities = proxyActivities<OrchestratorActivities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
    nonRetryableErrorTypes: [
      "TokenBudgetExhaustedError",
      "AgentAbortedError",
    ],
  },
});

/** Infrastructure: 5min timeout (fast container ops), 3 retries */
const infrastructureActivities = proxyActivities<InfrastructureActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

// ---------------------------------------------------------------------------
// Timeout Constants
// ---------------------------------------------------------------------------

/** Time before sending approval reminder (24 hours) */
const REMINDER_TIMEOUT = "24 hours";
/** Additional wait after reminder (48h more = 72h total) */
const FINAL_TIMEOUT = "48 hours";
/** Wait for PR review feedback or merge/close (7 days) */
const FEEDBACK_TIMEOUT = "7 days";

// ---------------------------------------------------------------------------
// Query Definition
// ---------------------------------------------------------------------------

/**
 * Query status for checking orchestrator workflow state.
 */
export interface OrchestratorQueryStatus {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Current workflow phase */
  phase: OrchestratorWorkflowPhase;
  /** PR number if created */
  prNumber?: number | undefined;
  /** PR URL if created */
  prUrl?: string | undefined;
  /** Error message if any */
  errorMessage?: string | undefined;
}

export const orchestratorStatusQuery =
  wf.defineQuery<OrchestratorQueryStatus>("orchestratorStatus");

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Orchestrator Workflow (v2.2)
 *
 * Thin Temporal shell around the agentic orchestrator loop.
 *
 * Flow:
 * 1. Setup: Spawn container, configure git, clone repo
 * 2. Pre-approval loop: Run orchestrator for research + planning (repeats on rejection)
 * 3. Approval wait: 24h reminder -> 72h timeout
 * 4. Post-approval: Run orchestrator for execution + PR creation
 * 5. PR wait: Wait for merge, close, or review feedback (7-day timeout)
 * 6. Feedback loop: Handle review -> fix -> wait cycles (repeats on new feedback)
 * 7. Complete: Mark task done
 *
 * @param input - Workflow input with task, issue, and slack channel
 * @returns Workflow result with success, phase, and optional PR info
 */
export async function orchestratorWorkflow(
  input: OrchestratorWorkflowInput,
): Promise<OrchestratorWorkflowResult> {
  const { taskId, issue, slackChannel } = input;
  const workflowId = wf.workflowInfo().workflowId;

  // ---------------------------------------------------------------------------
  // Mutable signal state
  // ---------------------------------------------------------------------------
  const state = {
    phase: "pending" as OrchestratorWorkflowPhase,
    approval: null as PlanApprovalPayload | null,
    prFeedback: null as string | null,
    prCompletion: null as PRCompletionPayload | null,
    escalationResolution: null as {
      action: "retry" | "abort";
      guidance?: string;
    } | null,
    prNumber: undefined as number | undefined,
    prUrl: undefined as string | undefined,
    errorMessage: undefined as string | undefined,
    totalTokens: { input: 0, output: 0 },
  };

  // Helper to accumulate token counts
  const addTokens = (tokenCount: { input: number; output: number }) => {
    state.totalTokens.input += tokenCount.input;
    state.totalTokens.output += tokenCount.output;
  };

  // ---------------------------------------------------------------------------
  // Signal handlers
  // ---------------------------------------------------------------------------
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

  wf.setHandler(prCompletionSignal, (completion) => {
    wf.log.info("Received PR completion signal", {
      merged: completion.merged,
      prNumber: completion.prNumber,
    });
    state.prCompletion = completion;
  });

  wf.setHandler(escalationResolvedSignal, (resolution) => {
    wf.log.info("Received escalation resolution signal", {
      action: resolution.action,
    });
    state.escalationResolution = resolution;
  });

  // ---------------------------------------------------------------------------
  // Query handler
  // ---------------------------------------------------------------------------
  wf.setHandler(orchestratorStatusQuery, (): OrchestratorQueryStatus => {
    const result: OrchestratorQueryStatus = {
      taskId,
      phase: state.phase,
    };
    // Conditional assignment for exactOptionalPropertyTypes
    if (state.prNumber !== undefined) {
      result.prNumber = state.prNumber;
    }
    if (state.prUrl !== undefined) {
      result.prUrl = state.prUrl;
    }
    if (state.errorMessage !== undefined) {
      result.errorMessage = state.errorMessage;
    }
    return result;
  });

  // ---------------------------------------------------------------------------
  // Phase 1: Setup container
  // ---------------------------------------------------------------------------
  wf.log.info("Starting orchestrator workflow", {
    taskId,
    issueIdentifier: issue.identifier,
  });

  state.phase = "setup";

  try {
    await infrastructureActivities.setupContainerActivity({
      taskId,
      issue: { identifier: issue.identifier, title: issue.title },
      workflowId,
    });
  } catch (error) {
    state.phase = "failed";
    state.errorMessage = `Container setup failed: ${String(error)}`;
    await infrastructureActivities.completeTaskActivity({
      taskId,
      success: false,
    });
    await wf.condition(wf.allHandlersFinished);
    return {
      success: false,
      phase: "failed",
      errorMessage: state.errorMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Pre-approval loop (supports unlimited rejection/re-planning)
  // ---------------------------------------------------------------------------
  let approved = false;
  let rejectionFeedback: string | undefined;

  while (!approved) {
    state.phase = "pre_approval";

    // Build pre-approval input with conditional rejectionFeedback
    const preApprovalInput: {
      taskId: string;
      issue: OrchestratorWorkflowInput["issue"];
      slackChannel: string;
      workflowId: string;
      rejectionFeedback?: string;
    } = {
      taskId,
      issue,
      slackChannel,
      workflowId,
    };
    if (rejectionFeedback !== undefined) {
      preApprovalInput.rejectionFeedback = rejectionFeedback;
    }

    const preResult =
      await orchestratorActivities.runOrchestratorPreApproval(preApprovalInput);

    addTokens(preResult.tokenCount);

    if (preResult.status === "error") {
      state.phase = "failed";
      state.errorMessage = preResult.plan;
      await infrastructureActivities.stopContainerActivity(taskId);
      await infrastructureActivities.completeTaskActivity({
        taskId,
        success: false,
      });
      await wf.condition(wf.allHandlersFinished);
      return {
        success: false,
        phase: "failed",
        errorMessage: state.errorMessage,
        totalTokenCount: state.totalTokens,
      };
    }

    // ---------------------------------------------------------------------------
    // Phase 3: Approval wait (24h reminder + 72h total)
    // ---------------------------------------------------------------------------
    state.phase = "awaiting_approval";

    // Wait for approval signal with 24h timeout
    const gotApproval = await wf.condition(
      () => state.approval !== null,
      REMINDER_TIMEOUT,
    );

    if (!gotApproval) {
      // 24h passed: stop container to free resources, send reminder via orchestrator
      wf.log.info("Approval timeout (24h), stopping container", { taskId });
      await infrastructureActivities.stopContainerActivity(taskId);

      // Wait 48h more (72h total)
      const lateApproval = await wf.condition(
        () => state.approval !== null,
        FINAL_TIMEOUT,
      );

      if (!lateApproval) {
        // 72h total timeout
        state.phase = "timeout";
        await infrastructureActivities.completeTaskActivity({
          taskId,
          success: false,
        });
        await wf.condition(wf.allHandlersFinished);
        return {
          success: false,
          phase: "timeout",
          errorMessage: `Plan approval timed out after 72 hours for ${issue.identifier}`,
          totalTokenCount: state.totalTokens,
        };
      }
    }

    // Process approval decision
    const decision = state.approval;
    if (decision?.approved) {
      approved = true;
    } else {
      // Rejection: store feedback and loop back for re-planning
      wf.log.info("Plan rejected, re-entering pre-approval loop", {
        hasFeedback: !!decision?.feedback,
      });
      rejectionFeedback =
        decision?.feedback ?? "Plan rejected without specific feedback";
      // Reset approval state for next iteration
      state.approval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Post-approval execution
  // ---------------------------------------------------------------------------
  state.phase = "post_approval";

  const postResult = await orchestratorActivities.runOrchestratorPostApproval({
    taskId,
    issue,
    slackChannel,
    workflowId,
  });

  addTokens(postResult.tokenCount);

  if (postResult.prNumber !== undefined) {
    state.prNumber = postResult.prNumber;
  }
  if (postResult.prUrl !== undefined) {
    state.prUrl = postResult.prUrl;
  }

  if (postResult.status === "error") {
    state.phase = "failed";
    state.errorMessage =
      postResult.errorMessage ?? "Post-approval execution failed";
    await infrastructureActivities.stopContainerActivity(taskId);
    await infrastructureActivities.completeTaskActivity({
      taskId,
      success: false,
    });
    await wf.condition(wf.allHandlersFinished);
    const result: OrchestratorWorkflowResult = {
      success: false,
      phase: "failed",
      errorMessage: state.errorMessage,
      totalTokenCount: state.totalTokens,
    };
    if (state.prNumber !== undefined) {
      result.prNumber = state.prNumber;
    }
    if (state.prUrl !== undefined) {
      result.prUrl = state.prUrl;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Phase 5: PR wait + feedback loop
  // ---------------------------------------------------------------------------
  state.phase = "awaiting_pr";

  while (true) {
    const gotSignal = await wf.condition(
      () => state.prCompletion !== null || state.prFeedback !== null,
      FEEDBACK_TIMEOUT,
    );

    // PR completion (merge or close) takes priority
    if (state.prCompletion) {
      const completion = state.prCompletion;
      wf.log.info("PR completed", {
        merged: completion.merged,
        prNumber: completion.prNumber,
      });

      // Stop container and mark task
      await infrastructureActivities.stopContainerActivity(taskId);
      await infrastructureActivities.completeTaskActivity({
        taskId,
        success: completion.merged,
      });

      await wf.condition(wf.allHandlersFinished);

      const result: OrchestratorWorkflowResult = {
        success: completion.merged,
        phase: completion.merged ? "complete" : "failed",
        totalTokenCount: state.totalTokens,
      };
      if (state.prNumber !== undefined) {
        result.prNumber = state.prNumber;
      }
      if (state.prUrl !== undefined) {
        result.prUrl = state.prUrl;
      }
      if (!completion.merged) {
        result.errorMessage = "PR closed without merging";
      }
      return result;
    }

    // PR feedback (review comments)
    if (state.prFeedback) {
      state.phase = "addressing_feedback";
      const feedback = state.prFeedback;
      state.prFeedback = null; // Reset for next round

      wf.log.info("Addressing PR feedback", {
        taskId,
        feedbackLength: feedback.length,
      });

      const feedbackResult =
        await orchestratorActivities.handleOrchestratorFeedback({
          taskId,
          issue,
          slackChannel,
          workflowId,
          feedback,
        });

      addTokens(feedbackResult.tokenCount);

      // Return to awaiting_pr regardless of feedback outcome
      state.phase = "awaiting_pr";
      continue;
    }

    // Timeout (no signal received within FEEDBACK_TIMEOUT)
    if (!gotSignal) {
      wf.log.info("PR feedback timeout, completing workflow", { taskId });
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 6: Complete
  // ---------------------------------------------------------------------------
  state.phase = "complete";
  await infrastructureActivities.stopContainerActivity(taskId);
  await infrastructureActivities.completeTaskActivity({
    taskId,
    success: true,
  });

  await wf.condition(wf.allHandlersFinished);

  const finalResult: OrchestratorWorkflowResult = {
    success: true,
    phase: "complete",
    totalTokenCount: state.totalTokens,
  };
  if (state.prNumber !== undefined) {
    finalResult.prNumber = state.prNumber;
  }
  if (state.prUrl !== undefined) {
    finalResult.prUrl = state.prUrl;
  }
  return finalResult;
}
