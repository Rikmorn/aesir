/**
 * Aesir - Agentic Development Platform
 *
 * Entry point for the application.
 * Provides the main agent runner and re-exports public API.
 */

import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { devAgent } from "./agents/index.js";
import { devAgentConfig } from "./config/index.js";
import { logger } from "./logging/index.js";

/**
 * Result of an agent run
 */
export interface AgentRunResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** The final messages from the agent */
  messages: unknown[];
  /** Thread ID for this run */
  threadId: string;
  /** Error message if run failed */
  error?: string;
}

/**
 * Run the development agent with a task description
 *
 * This is the main entry point for invoking the agent. It:
 * - Logs the start of execution
 * - Invokes the agent with proper configuration
 * - Handles errors gracefully
 * - Logs completion with timing information
 *
 * @param taskDescription - Description of the task to perform
 * @param threadId - Unique identifier for this conversation thread
 * @returns Result of the agent run
 */
export async function runAgent(
  taskDescription: string,
  threadId: string
): Promise<AgentRunResult> {
  const agentLogger = logger.child({
    threadId,
    agentId: devAgentConfig.name,
  });

  const timing = agentLogger.startTimer("agent_run", {
    context: {
      taskDescriptionLength: taskDescription.length,
    },
    message: `Starting agent run: ${taskDescription.slice(0, 100)}${taskDescription.length > 100 ? "..." : ""}`,
  });

  try {
    // Invoke the agent with the task
    // Note: recursionLimit must be passed directly to invoke(), not in configurable (known bug)
    const result = await devAgent.invoke(
      {
        messages: [new HumanMessage(taskDescription)],
      },
      {
        configurable: { thread_id: threadId },
        recursionLimit: devAgentConfig.recursionLimit,
      }
    );

    timing.success({
      context: {
        messageCount: result.messages?.length ?? 0,
      },
      message: "Agent run completed successfully",
    });

    return {
      success: true,
      messages: result.messages ?? [],
      threadId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    timing.failure({
      message: errorMessage,
    });

    return {
      success: false,
      messages: [],
      threadId,
      error: errorMessage,
    };
  }
}

// Re-export public API from modules
export { logger, createLogger, type LogEntry, type LogLevel } from "./logging/index.js";
export { devAgent, agent, type DevAgent } from "./agents/index.js";
export {
  AgentConfigSchema,
  devAgentConfig,
  validateAgentConfig,
  mergeWithDefaults,
  type AgentConfig,
} from "./config/index.js";
export {
  codeGenTool,
  CodeGenInputSchema,
  CodeGenOutputSchema,
  type CodeGenInput,
  type CodeGenOutput,
} from "./tools/index.js";
export {
  AgentState,
  AgentStatusSchema,
  MAX_LOOP_COUNT,
  hasExceededLoopLimit,
  shouldContinue,
  createInitialState,
  type AgentStateType,
  type AgentStatus,
} from "./state/index.js";
