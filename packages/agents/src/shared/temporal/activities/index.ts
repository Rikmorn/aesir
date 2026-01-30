/**
 * Temporal Activities Index
 *
 * Re-exports all activities for worker registration.
 * Activities use MCP to communicate with integration services,
 * so they don't require SDK clients to be injected.
 */

// Linear activities
import { updateLinearStatusActivity } from "./linear-activities.js";

// Product agent activities
import {
  extractPhase,
  initProductAgentActivities,
  type ProductAgentActivityDeps,
  type RunProductAgentActivityInput,
  type RunProductAgentActivityOutput,
  runProductAgentActivity,
} from "./product-agent-activity.js";

// Slack activities
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
  MessageResult,
  ProductAgentActivityDeps,
  RunProductAgentActivityInput,
  RunProductAgentActivityOutput,
  StatusNotification,
};

// Re-export activities
export {
  extractPhase,
  initProductAgentActivities,
  runProductAgentActivity,
  sendApprovalRequestActivity,
  sendSlackReplyActivity,
  sendStatusUpdateActivity,
  updateLinearStatusActivity,
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
