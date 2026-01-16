/**
 * Configuration Module Public API
 *
 * Exports agent configuration schemas and utilities.
 */

export {
  AgentConfigSchema,
  devAgentConfig,
  validateAgentConfig,
  mergeWithDefaults,
  type AgentConfig,
  type AgentConfigInput,
} from "./agent-config.js";
