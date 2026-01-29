/**
 * Shared State Module
 *
 * Exports generic agent state schemas and utilities used across all agents.
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
