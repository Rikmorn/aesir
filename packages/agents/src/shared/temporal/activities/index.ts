/**
 * Temporal Activities Index
 *
 * Re-exports all activities for worker registration.
 * Activities use MCP to communicate with integration services,
 * so they don't require SDK clients to be injected.
 */

import type { Sandbox } from "@aesir/types";
import {
  completeTaskActivity,
  continueAfterApprovalActivity,
  type DevAgentActivitiesDeps,
  type HandlePRFeedbackInput,
  handlePRClosedActivity,
  handlePRFeedbackActivity,
  handleRePlanActivity,
  initDevAgentActivities,
  type RunDevAgentGraphInput,
  type RunDevAgentGraphOutput,
  runDevAgentGraphActivity,
  type SendReminderInput,
  sendReminderActivity,
  stopContainerActivity,
  syncApprovalToLinearActivity,
  updateSlackApprovalActivity,
} from "./dev-agent-activities.js";
// Import raw activities
import { executeDevWorkflow } from "./dev-agent-activity.js";
import {
  type MergePRInput,
  type MergePROutput,
  mergePRActivity,
} from "./github-activities.js";
import { updateLinearStatusActivity } from "./linear-activities.js";
import {
  extractPhase,
  initProductAgentActivities,
  type ProductAgentActivityDeps,
  type RunProductAgentActivityInput,
  type RunProductAgentActivityOutput,
  runProductAgentActivity,
} from "./product-agent-activity.js";
import {
  type ApprovalNotification,
  type MessageResult,
  type StatusNotification,
  sendApprovalRequestActivity,
  sendSlackReplyActivity,
  sendStatusUpdateActivity,
} from "./slack-activities.js";

// Re-export types for external use
export type {
  ApprovalNotification,
  DevAgentActivitiesDeps,
  HandlePRFeedbackInput,
  MergePRInput,
  MergePROutput,
  MessageResult,
  ProductAgentActivityDeps,
  RunDevAgentGraphInput,
  RunDevAgentGraphOutput,
  RunProductAgentActivityInput,
  RunProductAgentActivityOutput,
  SendReminderInput,
  StatusNotification,
};

/**
 * Dependencies required by Temporal activities.
 * Only sandbox is needed - integration calls go through MCP.
 */
export interface ActivityDependencies {
  /** Sandbox for code execution (dev workflow) */
  sandbox: Sandbox;
}

/**
 * Create bound activities with injected dependencies.
 *
 * Most activities use MCP and don't need client injection.
 * Only the dev workflow needs the sandbox for code execution.
 *
 * Usage in worker:
 * ```typescript
 * const worker = await Worker.create({
 *   activities: makeActivities(dependencies),
 *   ...
 * });
 * ```
 *
 * @param deps - Dependencies to bind to activities
 * @returns Object with bound activity functions
 */
export function makeActivities(deps: ActivityDependencies) {
  return {
    /**
     * Send approval request notification - uses MCP
     */
    sendApprovalRequestActivity,

    /**
     * Send status update notification - uses MCP
     */
    sendStatusUpdateActivity,

    /**
     * Merge pull request - uses MCP
     */
    mergePRActivity,

    /**
     * Update Linear issue status - uses MCP
     */
    updateLinearStatusActivity,

    /**
     * Run product agent - agentic tool-use loop via MCP
     */
    runProductAgentActivity,

    /**
     * Send reply to Slack thread - uses MCP
     */
    sendSlackReplyActivity,

    /**
     * Execute dev workflow - needs sandbox
     * @param taskId - Linear Issue ID
     * @param sessionId - Linear AgentSession ID for emitting activities
     */
    executeDevWorkflow: (taskId: string, sessionId: string) => {
      // Parse GITHUB_REPO in owner/repo format
      const [owner, repo] = (process.env.GITHUB_REPO ?? "/").split("/");
      return executeDevWorkflow(taskId, sessionId, {
        sandbox: deps.sandbox,
        githubConfig: {
          owner: owner || "",
          repo: repo || "",
          baseBranch: process.env.GITHUB_BASE_BRANCH ?? "main",
        },
      });
    },
  };
}

/**
 * Type for the bound activities returned by makeActivities.
 * Use this in workflows with proxyActivities<BoundActivities>().
 */
export type BoundActivities = ReturnType<typeof makeActivities>;

// Also export raw activities for backward compatibility and direct testing
export {
  completeTaskActivity,
  continueAfterApprovalActivity,
  executeDevWorkflow,
  extractPhase,
  handlePRClosedActivity,
  handlePRFeedbackActivity,
  handleRePlanActivity,
  initDevAgentActivities,
  initProductAgentActivities,
  mergePRActivity,
  runDevAgentGraphActivity,
  runProductAgentActivity,
  sendApprovalRequestActivity,
  sendReminderActivity,
  sendSlackReplyActivity,
  sendStatusUpdateActivity,
  stopContainerActivity,
  syncApprovalToLinearActivity,
  updateLinearStatusActivity,
  updateSlackApprovalActivity,
};

// === Orchestrator Activities (v2.2) ===

// Alias infrastructure activities to avoid name collision with legacy
import {
  completeTaskActivity as orchestratorCompleteTaskActivity,
  stopContainerActivity as orchestratorStopContainerActivity,
  setupContainerActivity,
} from "./infrastructure-activities.js";
import type {
  FeedbackInput,
  FeedbackOutput,
  HumanInputRequest,
  OrchestratorActivitiesDeps,
  OrchestratorIssueContext,
  PostApprovalInput,
  PostApprovalOutput,
  PreApprovalInput,
  PreApprovalOutput,
} from "./orchestrator-activities.js";
import {
  getOrchestratorDeps,
  handleOrchestratorFeedback,
  initOrchestratorActivities,
  parseHumanInputMarker,
  runOrchestratorPostApproval,
  runOrchestratorPreApproval,
} from "./orchestrator-activities.js";

// Re-export orchestrator types
export type {
  CompleteTaskInput as OrchestratorCompleteTaskInput,
  SetupContainerInput,
  SetupContainerOutput,
} from "./infrastructure-activities.js";
export type {
  FeedbackInput,
  FeedbackOutput,
  HumanInputRequest,
  OrchestratorActivitiesDeps,
  OrchestratorIssueContext,
  PostApprovalInput,
  PostApprovalOutput,
  PreApprovalInput,
  PreApprovalOutput,
};

// Re-export orchestrator activities
export {
  getOrchestratorDeps,
  handleOrchestratorFeedback,
  initOrchestratorActivities,
  orchestratorCompleteTaskActivity,
  orchestratorStopContainerActivity,
  parseHumanInputMarker,
  runOrchestratorPostApproval,
  runOrchestratorPreApproval,
  setupContainerActivity,
};
