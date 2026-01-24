// @aesir/common - shared contracts, config loading, utilities

// Errors
export * from "./errors/index.js";
// Logging
export * from "./logging/index.js";
// MCP (Model Context Protocol)
export * from "./mcp/index.js";
// Agent config moved to @aesir/agents but re-exported here for backward compat
export {
  type AgentConfig,
  type AgentConfigInput,
  AgentConfigSchema,
  devAgentConfig,
  mergeWithDefaults,
  validateAgentConfig,
} from "./shim-agent-config.js";
// TEMPORARY: Config and agent-config shims for backward compatibility during Phase 22.1
// TODO: Remove after Plans 22.1-02 through 22.1-05 complete
export { config } from "./shim-config.js";
// State schemas and types (used by agents and platform)
export * from "./state/index.js";
// Temporal types (workflow-activity contracts)
export * from "./temporal/index.js";
// Shared types (cross-layer contracts)
export * from "./types/index.js";
// Utilities
export * from "./utils/index.js";
