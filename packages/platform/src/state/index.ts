/**
 * State Module Public API
 *
 * Exports agent state schema and utilities for state management.
 */

export {
  AgentState,
  type AgentStateType,
  type AgentStateUpdate,
  type AgentStatus,
  AgentStatusSchema,
  createInitialState,
  hasExceededLoopLimit,
  MAX_LOOP_COUNT,
  shouldContinue,
} from "./agent-state.js";

export {
  createDevWorkflowInitialState,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowConfig,
  DevWorkflowState,
  type DevWorkflowStateType,
  type DevWorkflowStateUpdate,
  type DevWorkflowStatus,
  DevWorkflowStatusSchema,
  didTestsPass,
  type FileChange,
  FileChangeSchema,
  hasExceededTestLimit,
} from "./dev-workflow-state.js";
