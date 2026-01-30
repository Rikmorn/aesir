/**
 * Coordination Tools
 *
 * Tool factories for orchestrator coordination: spawning sub-agents
 * and requesting human input via Slack.
 */

export {
  createRequestHumanInputTool,
  HUMAN_INPUT_MARKER,
} from "./request-human-input.js";
export {
  type AgentTypeConfig,
  createSpawnAgentTool,
  type SpawnAgentDeps,
} from "./spawn-agent.js";
