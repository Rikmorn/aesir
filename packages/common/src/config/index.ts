/**
 * Configuration Module Public API
 *
 * Exports environment configuration and agent configuration schemas.
 */

// Agent configuration schemas and utilities
export {
  type AgentConfig,
  type AgentConfigInput,
  AgentConfigSchema,
  devAgentConfig,
  mergeWithDefaults,
  validateAgentConfig,
} from "./agent-config.js";
// Environment configuration (Zod-validated)
export { config, env } from "./env.js";
