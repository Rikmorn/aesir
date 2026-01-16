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
