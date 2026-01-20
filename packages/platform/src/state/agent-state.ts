/**
 * Agent State Schema
 *
 * Defines the state structure for the code generation agent using LangGraph's
 * Annotation API with Zod for type safety.
 *
 * Key design decisions:
 * - loopCount provides defense-in-depth beyond LangGraph's recursionLimit
 * - status field enables graceful termination handling
 * - messages use concat reducer for conversation history
 * - generatedCode uses null for empty state (exactOptionalPropertyTypes)
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

/**
 * Possible agent execution statuses
 */
export const AgentStatusSchema = z.enum([
  "running",
  "completed",
  "error",
  "timeout",
]);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Maximum iterations before agent terminates
 * Defense-in-depth beyond LangGraph's recursionLimit
 */
export const MAX_LOOP_COUNT = 10;

/**
 * Agent state definition using LangGraph Annotation API
 *
 * Uses reducers to define how state updates:
 * - messages: concat (append new messages to history)
 * - loopCount, status, taskDescription, generatedCode: replace (overwrite)
 */
export const AgentState = Annotation.Root({
  /**
   * Message history for the conversation
   * Uses concat reducer to build up conversation over iterations
   */
  messages: Annotation<BaseMessage[]>({
    reducer: (current, incoming) => current.concat(incoming),
    default: () => [],
  }),

  /**
   * Current loop iteration count
   * Used for defense-in-depth loop protection
   * Incremented each agent iteration, checked against MAX_LOOP_COUNT
   */
  loopCount: Annotation<number>({
    reducer: (_current, incoming) => incoming,
    default: () => 0,
  }),

  /**
   * Current execution status
   * Controls agent flow and termination
   */
  status: Annotation<AgentStatus>({
    reducer: (_current, incoming) => incoming,
    default: () => "running" as AgentStatus,
  }),

  /**
   * The task description for code generation
   * Set at the start of agent execution
   */
  taskDescription: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "",
  }),

  /**
   * Generated code output
   * null when no code has been generated yet
   */
  generatedCode: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),
});

/**
 * Type for the agent state
 */
export type AgentStateType = typeof AgentState.State;

/**
 * Type for partial state updates
 */
export type AgentStateUpdate = typeof AgentState.Update;

/**
 * Check if the agent has exceeded the maximum loop count
 */
export function hasExceededLoopLimit(state: AgentStateType): boolean {
  return state.loopCount >= MAX_LOOP_COUNT;
}

/**
 * Check if the agent should continue execution
 */
export function shouldContinue(state: AgentStateType): boolean {
  return state.status === "running" && !hasExceededLoopLimit(state);
}

/**
 * Create an initial state for the agent
 */
export function createInitialState(
  taskDescription: string,
): Partial<AgentStateType> {
  return {
    messages: [],
    loopCount: 0,
    status: "running" as AgentStatus,
    taskDescription,
    generatedCode: null,
  };
}
