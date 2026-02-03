/**
 * Coordination Tools
 *
 * Tool factories for agent coordination: human input requests and sub-agent spawning.
 */

export {
  createRequestHumanInputTool,
  HUMAN_INPUT_MARKER,
} from "./request-human-input.js";

export { createSpawnAgentTool } from "./spawn-agent.js";
