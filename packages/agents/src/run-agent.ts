/**
 * Agent Runner with Safety Guardrails
 *
 * Provides a wrapper around the dev agent that enforces safety guardrails:
 * - Recursion limit via invoke parameter (catches GraphRecursionError)
 * - Wall-clock timeout via AbortController
 * - Structured result with termination reason
 *
 * Design decisions:
 * - GraphRecursionError is caught and handled gracefully (not a crash)
 * - AbortController provides execution-level timeout (stepTimeout unreliable)
 * - All guardrails log with appropriate context for debugging
 * - Returns structured result with clear termination reason
 */

import {
  createPinoLogger,
  devAgentConfig,
  type PinoLogger,
} from "@aesir/common";
import { GraphRecursionError } from "@langchain/langgraph";
import { devAgent } from "./dev-agent.js";

const logger: PinoLogger = createPinoLogger({ component: "agents:runner" });

/**
 * Termination reasons for agent execution
 */
export type TerminationReason =
  | "completed"
  | "recursion_limit"
  | "timeout"
  | "loop_limit"
  | "error";

/**
 * Result of agent execution
 */
export interface AgentResult {
  /** Whether the agent completed successfully */
  success: boolean;
  /** Result data if successful */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Why the agent terminated */
  terminationReason: TerminationReason;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Run the agent with safety guardrails
 *
 * Enforces:
 * - Recursion limit (GraphRecursionError handling)
 * - Wall-clock timeout (AbortController)
 *
 * @param taskDescription - The task for the agent to perform
 * @param threadId - Thread ID for state persistence
 * @param timeoutMs - Optional timeout override (default from config)
 * @returns Structured result with termination reason
 */
export async function runAgentWithGuardrails(
  taskDescription: string,
  threadId: string,
  timeoutMs: number = devAgentConfig.timeoutMs,
): Promise<AgentResult> {
  const startTime = Date.now();
  const abortController = new AbortController();

  // Set up wall-clock timeout
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  const agentLogger = logger.child({ threadId });

  agentLogger.info(
    {
      taskDescriptionLength: taskDescription.length,
      recursionLimit: devAgentConfig.recursionLimit,
      maxIterations: devAgentConfig.maxIterations,
      timeoutMs,
    },
    "Starting agent execution",
  );

  try {
    const result = await devAgent.invoke(
      {
        messages: [{ role: "user", content: taskDescription }],
      },
      {
        configurable: { thread_id: threadId },
        recursionLimit: devAgentConfig.recursionLimit, // NOT in configurable (known bug)
        signal: abortController.signal,
      },
    );

    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;

    agentLogger.info({ durationMs }, "Agent execution completed successfully");

    return {
      success: true,
      result,
      terminationReason: "completed",
      durationMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    // Handle timeout (AbortError)
    if (error instanceof Error && error.name === "AbortError") {
      agentLogger.warn(
        { timeoutMs, durationMs },
        `Agent exceeded timeout of ${timeoutMs}ms`,
      );

      return {
        success: false,
        error: `Agent exceeded timeout of ${timeoutMs}ms`,
        terminationReason: "timeout",
        durationMs,
      };
    }

    // Handle recursion limit
    if (error instanceof GraphRecursionError) {
      agentLogger.warn(
        { limit: devAgentConfig.recursionLimit, durationMs },
        "Agent exceeded recursion limit",
      );

      return {
        success: false,
        error: "Agent exceeded recursion limit",
        terminationReason: "recursion_limit",
        durationMs,
      };
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);

    agentLogger.error(
      { err: errorMessage, durationMs },
      "Agent execution failed",
    );

    return {
      success: false,
      error: errorMessage,
      terminationReason: "error",
      durationMs,
    };
  }
}
