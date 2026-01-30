/**
 * Integration Tools
 *
 * ToolDefinition factories for all MCP integration tools (Linear, GitHub, Slack).
 * Each factory returns an array of ToolDefinition objects that wrap MCP HTTP calls.
 */

export { createGitHubTools } from "./github-tools.js";
export { createLinearTools } from "./linear-tools.js";
export { createMcpToolWrapper, type McpToolDeps } from "./mcp-wrapper.js";
export { createSlackTools } from "./slack-tools.js";
