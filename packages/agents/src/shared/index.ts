/**
 * Shared Module
 *
 * Common utilities and infrastructure used by all agents.
 * This includes MCP client, agent loop, database, and tools.
 */

// Agent loop runtime
export * from "./agent-loop/index.js";
// Agent configuration
export * from "./config/index.js";
// Database client and schema
export * from "./db/index.js";
// Environment configuration
export * from "./env/index.js";
// MCP client for integration communication
export * from "./mcp/index.js";
// Tools for agent invocation
export * from "./tools/index.js";
