/**
 * State Module Public API
 *
 * Exports agent state schema and utilities for state management.
 */

export {
  AgentState,
  AgentStatusSchema,
  MAX_LOOP_COUNT,
  createInitialState,
  hasExceededLoopLimit,
  shouldContinue,
  type AgentStatus,
  type AgentStateType,
  type AgentStateUpdate,
} from "./agent-state.js";

export {
  FileChangeSchema,
  DevWorkflowStatusSchema,
  DevWorkflowState,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  hasExceededTestLimit,
  didTestsPass,
  createDevWorkflowInitialState,
  type FileChange,
  type DevWorkflowStatus,
  type DevWorkflowConfig,
  type DevWorkflowStateType,
  type DevWorkflowStateUpdate,
} from "./dev-workflow-state.js";
