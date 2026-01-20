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
 * - setupCheckpointer must be called before first use to create database tables
 *
 * Environment:
 * - DATABASE_URL: Required PostgreSQL connection string
 *   Example: postgresql://temporal:temporal@localhost:5432/temporal
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { logger } from "../logging/index.js";
import { codeGenTool } from "../tools/index.js";

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
 * Requires DATABASE_URL environment variable.
 * Note: Call setupCheckpointer() before first agent use to create tables.
 *
 * @param connectionString - PostgreSQL connection string (defaults to DATABASE_URL env var)
 * @throws Error if DATABASE_URL is not set
 */
function createCheckpointer(connectionString?: string): PostgresSaver {
  const connStr = connectionString ?? process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error(
      "DATABASE_URL environment variable is required for checkpointer. " +
        "Example: DATABASE_URL=postgresql://temporal:temporal@localhost:5432/temporal",
    );
  }
  return PostgresSaver.fromConnString(connStr);
}

// Lazy checkpointer - created on first access
let CHECKPOINTER: PostgresSaver | undefined;

/**
 * Get or create the checkpointer instance
 * Uses lazy initialization to defer DATABASE_URL requirement until actual use
 */
function getCheckpointer(): PostgresSaver {
  if (!CHECKPOINTER) {
    CHECKPOINTER = createCheckpointer();
  }
  return CHECKPOINTER;
}

/**
 * Setup the checkpointer database tables
 * Must be called before first agent use. Safe to call multiple times (idempotent).
 *
 * @example
 * ```typescript
 * import { setupCheckpointer, devAgent } from './agents/dev-agent.js';
 *
 * // On application startup
 * await setupCheckpointer();
 *
 * // Now agent can be used
 * await devAgent.invoke({ messages: [...] }, config);
 * ```
 */
export async function setupCheckpointer(): Promise<void> {
  await getCheckpointer().setup();
}

/**
 * LLM instance for the agent
 */
const llm = createLLM();

/**
 * Development agent using createReactAgent prebuilt
 *
 * This agent:
 * - Uses Claude 3.5 Sonnet for reasoning
 * - Has access to the code generation tool
 * - Persists state via PostgresSaver checkpointer
 * - Follows the ReAct (Reason + Act) loop pattern
 *
 * NOTE: Call setupCheckpointer() before first use to initialize database tables.
 */
export const devAgent = createReactAgent({
  llm,
  tools: [codeGenTool],
  // Use getter to defer checkpointer creation until first agent use
  get checkpointSaver() {
    return getCheckpointer();
  },
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
