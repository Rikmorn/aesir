/**
 * Agent Guard Functions
 *
 * Provides conditional routing and state update functions for agent safety.
 * These guards work with the agent state to enforce iteration limits.
 *
 * Design decisions:
 * - createLoopGuard creates a reusable guard function with configurable limit
 * - Guard returns routing decision (END or "tools") for use in graph edges
 * - incrementLoopCount is a pure state update function
 * - Guards log when limits are reached for debugging
 *
 * Note: For createReactAgent, we wrap the agent invocation rather than
 * modifying the graph. These guards provide observability and can trigger
 * early termination via the runner when building custom graphs.
 */

import { END } from "@langchain/langgraph";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { logger } from "../logging/index.js";

/**
 * State shape required for loop guards
 */
export interface LoopGuardState {
  /** Current iteration count */
  loopCount: number;
  /** Message history */
  messages: BaseMessage[];
}

/**
 * Routing decisions from guards
 */
export type GuardRouting = typeof END | "tools";

/**
 * Create a loop guard function that checks iteration limits
 *
 * The guard:
 * 1. Checks if loop count exceeds the limit
 * 2. If exceeded, logs and returns END to stop the graph
 * 3. Otherwise, checks if there are tool calls to process
 * 4. Returns "tools" if tool calls exist, END otherwise
 *
 * @param maxIterations - Maximum allowed iterations
 * @returns Guard function for use in graph conditional edges
 */
export function createLoopGuard(maxIterations: number) {
  const guardLogger = logger.child({ guard: "loop" });

  return function checkLoopLimit(state: LoopGuardState): GuardRouting {
    // Check iteration limit first
    if (state.loopCount >= maxIterations) {
      guardLogger.warn("loop_limit_reached", {
        context: { loopCount: state.loopCount, maxIterations },
        outcome: "failure",
        message: `Loop limit ${maxIterations} reached`,
      });
      return END;
    }

    // Check if last message has tool calls
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return "tools";
    }

    // No more tool calls, end the graph
    return END;
  };
}

/**
 * Increment the loop count in state
 *
 * Pure function that returns a state update object.
 * Use in graph nodes to track iterations.
 *
 * @param state - Current state with loop count
 * @returns State update with incremented loop count
 */
export function incrementLoopCount(state: { loopCount: number }): {
  loopCount: number;
} {
  return { loopCount: state.loopCount + 1 };
}

/**
 * Check if the current state has exceeded the loop limit
 *
 * Utility function for checking loop status without routing.
 *
 * @param state - Current state with loop count
 * @param maxIterations - Maximum allowed iterations
 * @returns true if limit exceeded
 */
export function hasExceededLimit(
  state: { loopCount: number },
  maxIterations: number
): boolean {
  return state.loopCount >= maxIterations;
}
