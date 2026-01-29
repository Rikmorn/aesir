/**
 * Dev Agent Temporal Activities
 *
 * Activities for the dev-agent Temporal workflow.
 * Each activity wraps a segment of the LangGraph workflow.
 *
 * Uses DI pattern: call initDevAgentActivities() at worker startup
 * before activities are used.
 */

import type {
  DevContainerCleanup,
  DevContainerGit,
  DevContainerManager,
} from "@aesir/platform";
import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  createDevAgentGraph,
  type DevAgentGraph,
  type DevAgentPhase,
  type DevAgentState,
  type LinearIssueContext,
} from "../../../dev-agent/index.js";
import { callMcpTool } from "../../mcp/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:activities",
});

/**
 * Dependencies required by dev-agent activities.
 * Injected via initDevAgentActivities at worker startup.
 */
export interface DevAgentActivitiesDeps {
  /** Container manager for spawning/managing dev containers */
  manager: DevContainerManager;
  /** Cleanup service for container cleanup */
  cleanup: DevContainerCleanup;
  /** Git operations within containers */
  git: DevContainerGit;
  /** GitHub repo URL for cloning */
  repoUrl: string;
  /** GitHub token for authentication */
  githubToken: string;
  /** GitHub owner */
  owner: string;
  /** GitHub repo name */
  repo: string;
  /** Base branch for PRs (default: main) */
  baseBranch: string;
  /** Default Slack channel for notifications */
  slackChannel: string;
  /** Optional LLM instance (uses default if not provided) */
  llm?: ChatAnthropic;
  /** Optional checkpointer for state persistence */
  checkpointer?: PostgresSaver;
}

/** Module-level dependencies - must be initialized before use */
let deps: DevAgentActivitiesDeps | null = null;

/**
 * Initialize dev-agent activities with dependencies.
 *
 * Must be called at Temporal worker startup before any activities run.
 *
 * @param dependencies - All required dependencies for dev-agent activities
 */
export function initDevAgentActivities(
  dependencies: DevAgentActivitiesDeps,
): void {
  deps = dependencies;
  logger.info("Dev agent activities initialized");
}

/**
 * Get dependencies, throwing if not initialized.
 * Internal helper for activities.
 */
function getDeps(): DevAgentActivitiesDeps {
  if (!deps) {
    throw new Error(
      "Dev agent activities not initialized. Call initDevAgentActivities() at worker startup.",
    );
  }
  return deps;
}

/**
 * Input for running the dev-agent graph
 */
export interface RunDevAgentGraphInput {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Linear issue context */
  issue: LinearIssueContext;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Starting phase (default: pending) */
  startPhase?: DevAgentPhase;
}

/**
 * Output from running the dev-agent graph
 */
export interface RunDevAgentGraphOutput {
  /** Phase the graph stopped at */
  phase: DevAgentPhase;
  /** PR number if created */
  prNumber?: number | undefined;
  /** PR URL if created */
  prUrl?: string | undefined;
  /** Error message if failed/escalated */
  errorMessage?: string | undefined;
  /** Slack message timestamp for update_message (set after approval request) */
  slackMessageTs?: string | undefined;
}

/**
 * Activity: Run dev-agent graph from start until a stopping point.
 *
 * Runs until graph reaches:
 * - awaiting_approval (needs human approval)
 * - awaiting_feedback (PR created, waiting for review)
 * - complete (success)
 * - escalated (needs human help)
 * - failed (unrecoverable error)
 *
 * @param input - Graph input with task, issue, and slack channel
 * @returns Graph result with phase and optional PR info
 */
export async function runDevAgentGraphActivity(
  input: RunDevAgentGraphInput,
): Promise<RunDevAgentGraphOutput> {
  const dependencies = getDeps();
  const { taskId, issue, slackChannel, startPhase } = input;
  const activityLogger = logger.child({ taskId });

  activityLogger.info(
    { issueIdentifier: issue.identifier, startPhase },
    "Running dev-agent graph",
  );

  // Build graph options - handle exactOptionalPropertyTypes
  const graphOptions: Parameters<typeof createDevAgentGraph>[0] = {
    manager: dependencies.manager,
    cleanup: dependencies.cleanup,
    git: dependencies.git,
    repoUrl: dependencies.repoUrl,
    githubToken: dependencies.githubToken,
    owner: dependencies.owner,
    repo: dependencies.repo,
    baseBranch: dependencies.baseBranch,
    slackChannel,
  };

  if (dependencies.llm !== undefined) {
    graphOptions.llm = dependencies.llm;
  }
  if (dependencies.checkpointer !== undefined) {
    graphOptions.checkpointer = dependencies.checkpointer;
  }

  activityLogger.info("Creating dev-agent graph");
  let graph: DevAgentGraph;
  try {
    graph = createDevAgentGraph(graphOptions);
    activityLogger.info("Graph created successfully");
  } catch (error) {
    activityLogger.error(
      {
        err: error,
        errorName: error instanceof Error ? error.name : "Unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "Failed to create graph",
    );
    throw error;
  }

  // Build initial state
  const initialState: Partial<DevAgentState> = {
    taskId,
    issue,
    phase: startPhase || "pending",
    slackChannel,
  };

  // Run graph with thread_id for state persistence
  const config = {
    configurable: {
      thread_id: taskId,
    },
  };

  let result: DevAgentState;
  try {
    activityLogger.info({ initialState }, "Invoking graph with initial state");
    result = await graph.invoke(initialState, config);
  } catch (error) {
    activityLogger.error(
      {
        err: error,
        errorName: error instanceof Error ? error.name : "Unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
        initialState,
      },
      "Graph invoke failed",
    );
    throw error;
  }

  activityLogger.info(
    { phase: result.phase, prNumber: result.prNumber },
    "Graph run complete",
  );

  return {
    phase: result.phase,
    prNumber: result.prNumber ?? undefined,
    prUrl: result.prUrl ?? undefined,
    errorMessage: result.errorMessage ?? undefined,
    slackMessageTs: result.slackMessageTs ?? undefined,
  };
}

/**
 * Activity: Continue graph from executing phase (after approval).
 *
 * Called when Temporal receives approval signal.
 *
 * @param input - Input with task, issue, and slack channel
 * @returns Graph result with phase and optional PR info
 */
export async function continueAfterApprovalActivity(input: {
  taskId: string;
  issue: LinearIssueContext;
  slackChannel: string;
}): Promise<RunDevAgentGraphOutput> {
  return runDevAgentGraphActivity({
    ...input,
    startPhase: "executing",
  });
}

/**
 * Input for handling PR feedback
 */
export interface HandlePRFeedbackInput {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Linear issue context */
  issue: LinearIssueContext;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Feedback content from PR review */
  feedback: string;
}

/**
 * Activity: Handle PR feedback.
 *
 * Called when Temporal receives PR feedback signal from GitHub review.
 * Runs the graph from addressing_feedback phase.
 *
 * @param input - Input with task, issue, channel, and feedback
 * @returns Result with phase and optional error
 */
export async function handlePRFeedbackActivity(
  input: HandlePRFeedbackInput,
): Promise<{
  phase: DevAgentPhase;
  errorMessage?: string | undefined;
}> {
  const dependencies = getDeps();
  const { taskId, issue, slackChannel, feedback } = input;
  const activityLogger = logger.child({ taskId });

  activityLogger.info(
    { feedbackLength: feedback.length },
    "Handling PR feedback",
  );

  // Build graph options
  const graphOptions: Parameters<typeof createDevAgentGraph>[0] = {
    manager: dependencies.manager,
    cleanup: dependencies.cleanup,
    git: dependencies.git,
    repoUrl: dependencies.repoUrl,
    githubToken: dependencies.githubToken,
    owner: dependencies.owner,
    repo: dependencies.repo,
    baseBranch: dependencies.baseBranch,
    slackChannel,
  };

  if (dependencies.llm !== undefined) {
    graphOptions.llm = dependencies.llm;
  }
  if (dependencies.checkpointer !== undefined) {
    graphOptions.checkpointer = dependencies.checkpointer;
  }

  const graph = createDevAgentGraph(graphOptions);

  // Run from addressing_feedback phase with feedback in state
  const result = await graph.invoke(
    {
      taskId,
      issue,
      slackChannel,
      phase: "addressing_feedback" as DevAgentPhase,
      prFeedback: feedback,
    },
    { configurable: { thread_id: taskId } },
  );

  activityLogger.info({ phase: result.phase }, "Feedback handling complete");

  return {
    phase: result.phase,
    errorMessage: result.errorMessage ?? undefined,
  };
}

/**
 * Activity: Stop container (on timeout).
 *
 * Called when approval timeout (24h) is reached.
 * Currently just logs - actual cleanup handled by cleanup service.
 *
 * Note: DevContainerManager doesn't have a stop method currently.
 * Container will be cleaned up by the timeout cleanup service.
 *
 * @param taskId - Task ID identifying the container
 */
export async function stopContainerActivity(taskId: string): Promise<void> {
  const activityLogger = logger.child({ taskId });
  activityLogger.info("Stopping container due to timeout");

  // Note: DevContainerManager doesn't have a stop method currently.
  // Container will be cleaned up by cleanup service based on inactivity.
  // For now, just log the intent.
  activityLogger.warn(
    "Container stop not implemented - will be cleaned by timeout service",
  );
}

/**
 * Input for sending reminder
 */
export interface SendReminderInput {
  /** Task ID for correlation */
  taskId: string;
  /** Slack channel for the reminder */
  slackChannel: string;
  /** Reminder message text */
  message: string;
}

/**
 * Activity: Send reminder to Slack.
 *
 * Sends a reminder message when timeout approaches.
 *
 * @param input - Input with task, channel, and message
 */
export async function sendReminderActivity(
  input: SendReminderInput,
): Promise<void> {
  const { taskId, slackChannel, message } = input;
  const activityLogger = logger.child({ taskId });

  activityLogger.info("Sending reminder");

  try {
    await callMcpTool({
      integration: "slack",
      tool: "send_message",
      params: {
        channel: slackChannel,
        text: message,
      },
      agentId: "dev-agent",
      correlationId: `reminder-${taskId}`,
    });

    activityLogger.info("Reminder sent successfully");
  } catch (error) {
    // Non-critical - log but don't fail
    activityLogger.warn({ err: error }, "Failed to send reminder");
  }
}

// === Approval Flow Activities ===

/**
 * Input for updating Slack approval message
 */
export interface UpdateSlackApprovalInput {
  /** Slack channel where the approval message was sent */
  slackChannel: string;
  /** Message timestamp for update_message */
  slackMessageTs: string;
  /** Name of the approver */
  approverName: string;
  /** Whether the plan was approved or rejected */
  approved: boolean;
  /** Estimated execution time (shown if approved) */
  estimatedTime?: string;
}

/**
 * Activity: Update Slack message after approval decision.
 *
 * Removes buttons and shows approval/rejection status.
 * Non-critical - fails gracefully if update fails.
 *
 * @param input - Input with channel, message timestamp, and approval info
 */
export async function updateSlackApprovalActivity(
  input: UpdateSlackApprovalInput,
): Promise<void> {
  const {
    slackChannel,
    slackMessageTs,
    approverName,
    approved,
    estimatedTime,
  } = input;
  const activityLogger = logger.child({
    activity: "updateSlackApproval",
    slackChannel,
    messageTs: slackMessageTs,
  });

  try {
    const timestamp = new Date().toLocaleTimeString();
    const text = approved
      ? `*Plan Approved* :white_check_mark:\nApproved by ${approverName} at ${timestamp}\n\nExecuting...${estimatedTime ? ` Estimated time: ~${estimatedTime}` : ""}`
      : `*Plan Rejected* :x:\nRejected by ${approverName} at ${timestamp}`;

    await callMcpTool({
      integration: "slack",
      tool: "update_message",
      params: {
        channel: slackChannel,
        ts: slackMessageTs,
        text,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ],
      },
      agentId: "dev-agent",
      correlationId: `approval-update-${slackMessageTs}`,
    });

    activityLogger.info({ approved }, "Slack approval message updated");
  } catch (error) {
    // Non-critical - log but don't fail
    activityLogger.warn({ err: error }, "Failed to update Slack message");
  }
}

/**
 * Input for syncing approval to Linear
 */
export interface SyncApprovalToLinearInput {
  /** Linear issue ID */
  issueId: string;
  /** Name of the approver */
  approverName: string;
  /** Whether the plan was approved */
  approved: boolean;
  /** Source channel of the approval */
  source: "slack" | "linear";
}

/**
 * Activity: Sync approval to Linear.
 *
 * When approval comes from Slack, adds a comment to Linear and updates status.
 * Skips sync if approval came from Linear (already there).
 * Non-critical - fails gracefully if sync fails.
 *
 * @param input - Input with issue ID, approver, and approval info
 */
export async function syncApprovalToLinearActivity(
  input: SyncApprovalToLinearInput,
): Promise<void> {
  const { issueId, approverName, approved, source } = input;
  const activityLogger = logger.child({
    activity: "syncApprovalToLinear",
    issueId,
    source,
  });

  // Only sync if approval came from Slack (Linear already knows if from Linear)
  if (source !== "slack") {
    activityLogger.debug("Skipping Linear sync - approval from Linear");
    return;
  }

  try {
    // Add comment about approval
    const commentBody = approved
      ? `Plan approved via Slack by ${approverName}`
      : `Plan rejected via Slack by ${approverName}`;

    await callMcpTool({
      integration: "linear",
      tool: "create_comment",
      params: {
        issueId,
        body: commentBody,
      },
      agentId: "dev-agent",
      correlationId: `linear-sync-${issueId}`,
    });

    // Update status if approved
    if (approved) {
      await callMcpTool({
        integration: "linear",
        tool: "update_issue_status",
        params: {
          issueId,
          statusName: "Executing",
        },
        agentId: "dev-agent",
        correlationId: `linear-sync-${issueId}`,
      });
    }

    activityLogger.info({ approved }, "Linear synced with Slack approval");
  } catch (error) {
    // Non-critical - log but don't fail
    activityLogger.warn({ err: error }, "Failed to sync approval to Linear");
  }
}

/**
 * Input for handling re-plan activity
 */
export interface HandleRePlanInput {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Linear issue context */
  issue: LinearIssueContext;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Rejection feedback to incorporate into revised plan */
  feedback: string;
}

/**
 * Activity: Handle plan rejection with re-planning.
 *
 * Runs the graph from re_planning phase with feedback.
 * The graph will generate a revised plan and post to Slack thread.
 *
 * @param input - Input with task, issue, channel, and feedback
 * @returns Graph result from re-planning
 */
export async function handleRePlanActivity(
  input: HandleRePlanInput,
): Promise<RunDevAgentGraphOutput> {
  const { taskId, issue, slackChannel, feedback } = input;
  const activityLogger = logger.child({
    activity: "handleRePlan",
    taskId,
  });

  activityLogger.info(
    { feedbackLength: feedback.length },
    "Starting re-plan with feedback",
  );

  const dependencies = getDeps();

  // Build graph options
  const graphOptions: Parameters<typeof createDevAgentGraph>[0] = {
    manager: dependencies.manager,
    cleanup: dependencies.cleanup,
    git: dependencies.git,
    repoUrl: dependencies.repoUrl,
    githubToken: dependencies.githubToken,
    owner: dependencies.owner,
    repo: dependencies.repo,
    baseBranch: dependencies.baseBranch,
    slackChannel,
  };

  if (dependencies.llm !== undefined) {
    graphOptions.llm = dependencies.llm;
  }
  if (dependencies.checkpointer !== undefined) {
    graphOptions.checkpointer = dependencies.checkpointer;
  }

  const graph = createDevAgentGraph(graphOptions);

  // Run from re_planning phase with feedback in state
  const result = await graph.invoke(
    {
      taskId,
      issue,
      slackChannel,
      phase: "re_planning" as DevAgentPhase,
      approvalFeedback: feedback,
    },
    { configurable: { thread_id: taskId } },
  );

  activityLogger.info(
    { phase: result.phase },
    "Re-planning complete, awaiting next approval",
  );

  return {
    phase: result.phase,
    prNumber: result.prNumber ?? undefined,
    prUrl: result.prUrl ?? undefined,
    errorMessage: result.errorMessage ?? undefined,
    slackMessageTs: result.slackMessageTs ?? undefined,
  };
}

// === Task Completion Activities ===

/**
 * Input for task completion activity (triggered by PR merge)
 */
export interface CompleteTaskInput {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Linear issue ID */
  issueId: string;
  /** Human-readable identifier (e.g., "ABC-123") */
  issueIdentifier: string;
  /** Issue title */
  issueTitle: string;
  /** PR number that was merged */
  prNumber: number;
  /** PR URL */
  prUrl: string;
  /** Whether the PR was merged (should always be true for this activity) */
  merged: boolean;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Container ID to cleanup */
  containerId?: string;
  /** Execution plan for stats */
  executionPlan?: {
    steps: Array<{ description: string; files: string[] }>;
  };
  /** Files changed for stats */
  files?: Array<{ path: string; content: string }>;
}

/**
 * Activity: Complete task after PR merge.
 *
 * Handles the full completion flow:
 * 1. Update Linear status to "Done"
 * 2. Send completion notification to Slack
 * 3. Cleanup dev container
 *
 * All operations are non-critical (fail gracefully with warnings).
 *
 * @param input - Completion input with task, PR, and slack info
 * @returns Success result
 */
export async function completeTaskActivity(
  input: CompleteTaskInput,
): Promise<{ success: boolean; error?: string }> {
  const activityLogger = logger.child({
    activity: "completeTask",
    taskId: input.taskId,
  });

  activityLogger.info(
    { merged: input.merged, prNumber: input.prNumber },
    "Running task completion",
  );

  // Build stats
  const stats = {
    filesChanged: input.files?.length ?? 0,
    executionSteps: input.executionPlan?.steps?.length ?? 0,
  };

  // 1. Update Linear status to Done
  try {
    await callMcpTool({
      integration: "linear",
      tool: "update_issue_status",
      params: {
        issueId: input.issueId,
        statusName: "Done",
      },
      agentId: "dev-agent",
      correlationId: `complete-${input.taskId}`,
    });
    activityLogger.info("Linear status updated to Done");
  } catch (error) {
    activityLogger.warn({ err: error }, "Failed to update Linear status");
  }

  // 2. Send completion notification to Slack (main channel, not thread)
  try {
    const message =
      `:white_check_mark: *${input.issueIdentifier} completed!*\n\n` +
      `*${input.issueTitle}*\n\n` +
      `PR: <${input.prUrl}|#${input.prNumber}>\n` +
      `Files: ${stats.filesChanged} | Steps: ${stats.executionSteps}`;

    await callMcpTool({
      integration: "slack",
      tool: "send_message",
      params: {
        channel: input.slackChannel,
        text: message,
      },
      agentId: "dev-agent",
      correlationId: `complete-${input.taskId}`,
    });
    activityLogger.info("Completion notification sent to Slack");
  } catch (error) {
    activityLogger.warn(
      { err: error },
      "Failed to send completion notification",
    );
  }

  // 3. Cleanup container
  if (input.containerId) {
    const dependencies = getDeps();
    try {
      await dependencies.cleanup.cleanupContainer(input.taskId);
      activityLogger.info(
        { containerId: input.containerId },
        "Container cleaned up",
      );
    } catch (error) {
      activityLogger.warn({ err: error }, "Failed to cleanup container");
    }
  }

  return { success: true };
}

/**
 * Input for handling PR closed without merge
 */
export interface HandlePRClosedInput {
  /** Task ID (Linear issue UUID) */
  taskId: string;
  /** Linear issue ID */
  issueId: string;
  /** Human-readable identifier (e.g., "ABC-123") */
  issueIdentifier: string;
  /** PR number that was closed */
  prNumber: number;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Container ID to cleanup */
  containerId?: string;
}

/**
 * Activity: Handle PR closed without merge.
 *
 * Notifies about cancellation and cleans up resources:
 * 1. Send notification to Slack about PR closure
 * 2. Cleanup dev container (PR is abandoned)
 *
 * All operations are non-critical (fail gracefully with warnings).
 *
 * @param input - Closure input with task and PR info
 * @returns Success result
 */
export async function handlePRClosedActivity(
  input: HandlePRClosedInput,
): Promise<{ success: boolean }> {
  const activityLogger = logger.child({
    activity: "handlePRClosed",
    taskId: input.taskId,
  });

  activityLogger.info({ prNumber: input.prNumber }, "PR closed without merge");

  // Notify Slack about closure
  try {
    await callMcpTool({
      integration: "slack",
      tool: "send_message",
      params: {
        channel: input.slackChannel,
        text: `:x: PR #${input.prNumber} for *${input.issueIdentifier}* was closed without merging.`,
      },
      agentId: "dev-agent",
      correlationId: `pr-closed-${input.taskId}`,
    });
  } catch (error) {
    activityLogger.warn({ err: error }, "Failed to notify about PR closure");
  }

  // Cleanup container (PR is abandoned)
  if (input.containerId) {
    const dependencies = getDeps();
    try {
      await dependencies.cleanup.cleanupContainer(input.taskId);
    } catch (error) {
      activityLogger.warn({ err: error }, "Failed to cleanup container");
    }
  }

  return { success: true };
}
