/**
 * Development Agent
 *
 * ReAct agent for code generation tasks using LangGraph's createReactAgent prebuilt.
 * Uses Claude as the LLM and PostgresSaver for state persistence.
 *
 * Design decisions:
 * - createReactAgent provides standard ReAct loop with tool calling
 * - PostgresSaver for persistence across restarts (requires DATABASE_URL)
 * - Exports compiled graph for langgraph.json configuration
 * - recursionLimit must be passed to invoke(), not withConfig() (known bug)
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
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
 * Uses PostgreSQL for persistence across restarts.
 * Requires DATABASE_URL environment variable.
 *
 * @param connectionString - PostgreSQL connection string (defaults to DATABASE_URL env var)
 */
async function createCheckpointer(connectionString?: string): Promise<PostgresSaver> {
  const connStr = connectionString ?? process.env["DATABASE_URL"];
  if (!connStr) {
    throw new Error("DATABASE_URL environment variable is required for checkpointer");
  }
  const saver = PostgresSaver.fromConnString(connStr);
  await saver.setup();
  return saver;
}

/**
 * Cached checkpointer instance for lazy initialization
 */
let _checkpointer: PostgresSaver | null = null;

/**
 * Get the checkpointer instance (lazy initialization)
 *
 * Creates and initializes the PostgresSaver on first call,
 * returns cached instance on subsequent calls.
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_checkpointer) {
    _checkpointer = await createCheckpointer();
  }
  return _checkpointer;
}

/**
 * LLM instance for the agent
 */
const llm = createLLM();

/**
 * Create the development agent with the provided checkpointer
 *
 * This agent:
 * - Uses Claude 3.5 Sonnet for reasoning
 * - Has access to the code generation tool
 * - Persists state via PostgresSaver checkpointer
 * - Follows the ReAct (Reason + Act) loop pattern
 *
 * @param checkpointer - PostgresSaver instance for state persistence
 */
export function createDevAgent(checkpointer: PostgresSaver) {
  return createReactAgent({
    llm,
    tools: [codeGenTool],
    checkpointSaver: checkpointer,
  });
}

/**
 * Logger instance for agent operations
 */
export const agentLogger = logger.child({ agentId: "dev-agent" });

/**
 * Type for the dev agent
 */
export type DevAgent = ReturnType<typeof createDevAgent>;
