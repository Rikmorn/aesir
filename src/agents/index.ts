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

// Dev Workflow exports
export {
  createDevWorkflow,
  routeAfterTest,
  type AfterTestRoute,
  type DevWorkflowDependencies,
  type DevWorkflowOptions,
  type GitHubConfig,
  type DevWorkflow,
} from "./dev-workflow.js";

export {
  runDevWorkflow,
  type DevWorkflowResult,
} from "./dev-workflow-runner.js";

// Tracing exports
export {
  LangGraphTracer,
  createLangGraphTracer,
} from "./tracing/index.js";
