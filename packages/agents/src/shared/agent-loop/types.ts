/**
 * Agent Loop Types
 *
 * Type definitions for the agent loop runtime that replaces LangGraph
 * state machine graphs with a custom Anthropic SDK tool-use loop.
 *
 * All types here define the contract between:
 * - Tool definitions (what agents can do)
 * - Loop options (how agents behave)
 * - Loop results (what agents produce)
 * - Trace steps (what agents did)
 */

import type { PinoLogger } from "@aesir/platform";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { TokenBudget } from "./token-budget.js";

// ---------------------------------------------------------------------------
// Tool Types
// ---------------------------------------------------------------------------

/**
 * Result returned by a tool execution.
 * Fed back to the LLM as a tool_result content block.
 */
export interface ToolResult {
  /** Text content fed back to the LLM */
  content: string;
  /** If true, LLM sees this as an error to reason about */
  isError?: boolean;
}

/**
 * Tool definition for the agent loop.
 *
 * Each tool has a Zod schema for input validation and an execute function
 * called by our custom loop (not by the SDK's toolRunner).
 *
 * Tool names must match: ^[a-zA-Z0-9_-]{1,64}$
 */
export interface ToolDefinition {
  /** Tool name (must match regex ^[a-zA-Z0-9_-]{1,64}$) */
  name: string;
  /** Detailed description of what the tool does, when to use it */
  description: string;
  /** Zod schema for input validation */
  inputSchema: z.ZodType;
  /** Execute the tool with validated input */
  execute: (input: unknown) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Callback Types
// ---------------------------------------------------------------------------

/**
 * Information about a tool call, passed to the onToolCall callback.
 */
export interface ToolCallInfo {
  /** Tool name */
  name: string;
  /** Tool input (raw from the LLM, before validation) */
  input: unknown;
  /** Unique tool_use ID from the LLM response */
  id: string;
}

/**
 * LLM response type alias.
 * Uses the Anthropic SDK's Message type directly.
 */
export type LLMResponse = Anthropic.Message;

// ---------------------------------------------------------------------------
// Status & Trace
// ---------------------------------------------------------------------------

/**
 * Why the agent loop stopped.
 *
 * Maps from Anthropic stop_reason values:
 * - end_turn, stop_sequence -> "completed"
 * - tool_use -> loop continues (not a terminal status)
 * - max_tokens, model_context_window_exceeded -> "max_tokens"
 * - refusal -> "error"
 *
 * Additional statuses from loop control:
 * - "max_iterations" -> hit iteration limit
 * - "aborted" -> AbortSignal fired
 */
export type AgentLoopStatus =
  | "completed"
  | "max_iterations"
  | "max_tokens"
  | "aborted"
  | "error";

/**
 * A single step in the execution trace.
 *
 * Captures tool calls, tool results, and LLM responses with timing
 * and token usage information for observability.
 */
export interface TraceStep {
  /** What kind of step this is */
  type: "tool_call" | "tool_result" | "llm_response";
  /** When this step occurred (ISO 8601) */
  timestamp: string;
  /** Tool name (for tool_call and tool_result steps) */
  toolName?: string;
  /** Unique tool_use ID from the LLM (for tool_call and tool_result steps) */
  toolCallId?: string;
  /** Input data (tool input for tool_call, undefined for others) */
  input?: unknown;
  /** Output data (tool output for tool_result, text for llm_response) */
  output?: unknown;
  /** Token usage for this step (for llm_response steps) */
  tokenCount?: { input: number; output: number };
  /** Duration of this step in milliseconds */
  durationMs?: number;
  /** Stop reason from the LLM (for llm_response steps) */
  stopReason?: string;
}

// ---------------------------------------------------------------------------
// Options & Result
// ---------------------------------------------------------------------------

/**
 * Configuration options for runAgentLoop().
 *
 * Required: systemPrompt, tools, initialMessage
 * Optional: everything else has sensible defaults (applied in the loop, not here)
 */
export interface AgentLoopOptions {
  /** System prompt defining agent behavior */
  systemPrompt: string;
  /** Available tools the agent can call */
  tools: ToolDefinition[];
  /** The initial task/message to send to the agent */
  initialMessage: string;
  /** Additional context prepended to the initial message */
  context?: string;
  /** Model to use (default handled in loop: "claude-sonnet-4-20250514") */
  model?: string;
  /** Maximum loop iterations before forced stop (default handled in loop: 50) */
  maxIterations?: number;
  /** Maximum tokens per LLM response (default handled in loop: 16384) */
  maxTokensPerResponse?: number;
  /** Shared mutable token budget across orchestrator and sub-agents */
  tokenBudget?: TokenBudget;
  /** Called on every tool call (for tracing/observability) */
  onToolCall?: (call: ToolCallInfo) => void;
  /** Called on every LLM response (for tracing/observability) */
  onResponse?: (response: LLMResponse) => void;
  /** AbortSignal for clean cancellation of the loop and in-flight API calls */
  abortSignal?: AbortSignal;
  /** Optional pino logger for warnings and debug info */
  logger?: PinoLogger;
}

/**
 * Result of an agent loop execution.
 *
 * Contains the final output, status, token usage, and full execution trace.
 */
export interface AgentLoopResult {
  /** Why the loop stopped */
  status: AgentLoopStatus;
  /** Final text output from the LLM */
  output: string;
  /** Parsed structured output if the final message contains JSON */
  structuredOutput?: unknown;
  /** Total number of tool call iterations (one iteration = one LLM response with tool_use) */
  toolCallCount: number;
  /** Cumulative token usage across all LLM calls */
  tokenCount: { input: number; output: number };
  /** Full execution trace with timing and token data */
  trace: TraceStep[];
}
