/**
 * Agents Module Public API
 *
 * Exports agent definitions and utilities.
 */

export {
  agent,
  agentLogger,
  type DevAgent,
  devAgent,
} from "./dev-agent.js";
// Dev Workflow exports
export {
  type AfterTestRoute,
  createDevWorkflow,
  type DevWorkflow,
  type DevWorkflowDependencies,
  type DevWorkflowOptions,
  type GitHubConfig,
  routeAfterTest,
} from "./dev-workflow.js";
export {
  type DevWorkflowResult,
  runDevWorkflow,
} from "./dev-workflow-runner.js";
export {
  createLoopGuard,
  type GuardRouting,
  hasExceededLimit,
  incrementLoopCount,
  type LoopGuardState,
} from "./guards.js";
export {
  type AgentResult,
  runAgentWithGuardrails,
  type TerminationReason,
} from "./run-agent.js";

// Tracing exports
export {
  createLangGraphTracer,
  LangGraphTracer,
} from "./tracing/index.js";
