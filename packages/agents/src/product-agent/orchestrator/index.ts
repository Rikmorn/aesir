/**
 * Product Agent Orchestrator Module
 *
 * Entry point and system prompt for the product agent.
 * The orchestrator replaces the 6-node LangGraph graph with an
 * agentic tool-use loop driven by a static system prompt.
 *
 * Exports:
 * - runProductAgent: Top-level entry point
 * - ProductAgentOptions: Configuration interface
 * - PRODUCT_AGENT_SYSTEM_PROMPT: Behavior definition
 */

export {
  type ProductAgentOptions,
  runProductAgent,
} from "./orchestrator.js";
export { PRODUCT_AGENT_SYSTEM_PROMPT } from "./system-prompts.js";
