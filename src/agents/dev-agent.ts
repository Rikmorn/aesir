/**
 * Development Agent
 *
 * ReAct agent for code generation tasks using LangGraph's createReactAgent prebuilt.
 * Uses Claude as the LLM and SqliteSaver for state persistence.
 *
 * Design decisions:
 * - createReactAgent provides standard ReAct loop with tool calling
 * - SqliteSaver for development (in-memory by default, file for persistence)
 * - Exports compiled graph for langgraph.json configuration
 * - recursionLimit must be passed to invoke(), not withConfig() (known bug)
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { codeGenTool } from "../tools/index.js";
import { logger } from "../logging/index.js";

/**
 * Default model for the agent
 * Claude 3.5 Sonnet recommended for code generation tasks
 */
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";

/**
 * Create the LLM instance for the agent
 */
function createLLM(model: string = DEFAULT_MODEL, temperature: number = 0) {
  return new ChatAnthropic({
    model,
    temperature,
  });
}

/**
 * Create the checkpointer for state persistence
 *
 * Default: in-memory for development
 * For persistence across restarts, use a file path: SqliteSaver.fromConnString("./data/checkpoints.db")
 */
function createCheckpointer(connectionString: string = ":memory:") {
  return SqliteSaver.fromConnString(connectionString);
}

/**
 * LLM instance for the agent
 */
const llm = createLLM();

/**
 * Checkpointer for state persistence
 * Using in-memory by default for development
 */
const checkpointer = createCheckpointer();

/**
 * Development agent using createReactAgent prebuilt
 *
 * This agent:
 * - Uses Claude 3.5 Sonnet for reasoning
 * - Has access to the code generation tool
 * - Persists state via SqliteSaver checkpointer
 * - Follows the ReAct (Reason + Act) loop pattern
 */
export const devAgent = createReactAgent({
  llm,
  tools: [codeGenTool],
  checkpointSaver: checkpointer,
});

/**
 * Export the compiled graph for use with langgraph.json
 * This enables LangGraph Studio and deployment support
 */
export const agent = devAgent;

/**
 * Logger instance for agent operations
 */
export const agentLogger = logger.child({ agentId: "dev-agent" });

/**
 * Type for the agent
 */
export type DevAgent = typeof devAgent;
