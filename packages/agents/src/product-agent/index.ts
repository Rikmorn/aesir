/**
 * Product Agent Module
 *
 * Provides the Product Agent for gathering requirements through
 * natural Slack dialogue and creating Linear issues.
 *
 * The agent uses an agentic tool-use loop driven by a static system
 * prompt, replacing the previous LangGraph state machine graph.
 * It communicates with the user directly via Slack tools and creates
 * Linear issues via MCP tool calls.
 *
 * @example
 * ```typescript
 * import { runProductAgent, PRODUCT_AGENT_SYSTEM_PROMPT } from './agents/product-agent';
 *
 * const result = await runProductAgent({
 *   threadTs: "1234567890.123456",
 *   channelId: "C12345678",
 *   message: "I need a dark mode feature",
 *   linearTeamId: "team-123",
 *   agentId: "product-agent",
 *   correlationId: "product-1234567890.123456",
 *   db,
 *   logger,
 * });
 * ```
 */

export {
  PRODUCT_AGENT_SYSTEM_PROMPT,
  type ProductAgentOptions,
  runProductAgent,
} from "./orchestrator/index.js";
