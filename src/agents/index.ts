/**
 * Agents Module Public API
 *
 * Exports agent definitions and utilities.
 */

export {
  devAgent,
  agent,
  agentLogger,
  type DevAgent,
} from "./dev-agent.js";

export {
  runAgentWithGuardrails,
  type AgentResult,
  type TerminationReason,
} from "./run-agent.js";

export {
  createLoopGuard,
  incrementLoopCount,
  hasExceededLimit,
  type LoopGuardState,
  type GuardRouting,
} from "./guards.js";
