/**
 * Core Agent Loop Runtime
 *
 * Implements the runAgentLoop() function that iterates LLM calls with tool
 * execution, forming the foundation every v2.2 agent builds on.
 *
 * Replaces LangGraph state machine graphs with a custom Anthropic SDK
 * tool-use loop providing:
 * - Native Anthropic tool-use (no LangChain)
 * - betaZodTool() for Zod-to-JSON-Schema conversion
 * - Configurable iteration limit and token budget
 * - AbortSignal for clean cancellation
 * - onToolCall / onResponse callbacks for tracing
 * - Structured result with execution trace
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  AgentLoopOptions,
  AgentLoopResult,
  AgentLoopStatus,
  ToolDefinition,
  ToolResult,
  TraceStep,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a ToolDefinition (Zod-based) to an Anthropic API Tool object.
 *
 * Uses betaZodTool() from the SDK to convert the Zod schema to JSON Schema,
 * then extracts the fields needed for the non-beta messages.create() API.
 * The dummy `run` function is required by betaZodTool but never called --
 * we execute tools manually in our custom loop.
 */
function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  // betaZodTool() always returns type: "custom" with name, description,
  // input_schema, run, and parse. The TypeScript union type for
  // BetaRunnableTool is too broad (includes non-custom tool types), so
  // we cast the result to access the known properties.
  const converted = betaZodTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: async () => "",
  }) as unknown as Anthropic.Tool;

  return {
    name: converted.name,
    description: tool.description,
    input_schema: converted.input_schema,
  };
}

/**
 * Map Anthropic stop_reason values to AgentLoopStatus.
 *
 * Handles all 6 known stop_reason values plus null/unknown gracefully.
 * Unknown values default to "completed" with a warning log.
 */
function mapStopReasonToStatus(
  stopReason: string | null,
  logger?: AgentLoopOptions["logger"],
): AgentLoopStatus {
  switch (stopReason) {
    case "end_turn":
      return "completed";
    case "tool_use":
      // Should not reach this mapping (tool_use continues the loop),
      // but handle gracefully if called directly.
      return "completed";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "stop_sequence":
      return "completed";
    case "refusal":
      return "error";
    case "pause_turn":
      // Server-tool only, unused in our loop. Treat as completed.
      return "completed";
    case null:
      return "completed";
    default:
      logger?.warn(
        { stopReason },
        "Unknown stop_reason from Anthropic API, treating as completed",
      );
      return "completed";
  }
}

/**
 * Extract text content from an Anthropic message's content blocks.
 */
function extractTextOutput(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Try to parse a string as JSON for structured output.
 * Returns undefined if not valid JSON.
 */
function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Build the initial user message, optionally prepending context.
 */
function buildInitialMessage(initialMessage: string, context?: string): string {
  if (context) {
    return `${context}\n\n${initialMessage}`;
  }
  return initialMessage;
}

/**
 * Build an AgentLoopResult with the given parameters.
 */
function buildResult(params: {
  status: AgentLoopStatus;
  output: string;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  trace: TraceStep[];
}): AgentLoopResult {
  const structuredOutput = tryParseJson(params.output);
  return {
    status: params.status,
    output: params.output,
    structuredOutput,
    toolCallCount: params.toolCallCount,
    tokenCount: {
      input: params.totalInputTokens,
      output: params.totalOutputTokens,
    },
    trace: params.trace,
  };
}

// ---------------------------------------------------------------------------
// Core Agent Loop
// ---------------------------------------------------------------------------

/**
 * Run an agent loop that iterates LLM calls with tool execution.
 *
 * This is the single most critical piece of v2.2. Every agent calls this
 * function. It handles:
 *
 * 1. LLM call with tools (LOOP-01, LOOP-02)
 * 2. Zod schema conversion via betaZodTool (LOOP-03)
 * 3. Iteration limit enforcement (LOOP-04)
 * 4. Token budget tracking (LOOP-05)
 * 5. AbortSignal cancellation (LOOP-06)
 * 6. Tracing callbacks (LOOP-07)
 * 7. Structured result return (LOOP-08)
 * 8. All stop_reason handling (LOOP-09)
 *
 * @param options - Loop configuration including system prompt, tools, and constraints
 * @returns Structured result with status, output, token usage, and trace
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    systemPrompt,
    tools,
    initialMessage,
    context,
    logger,
    tokenBudget,
    abortSignal,
    onToolCall,
    onResponse,
    onBudgetWarning,
    onHeartbeat,
  } = options;

  // Apply defaults
  const maxIterations = options.maxIterations ?? 50;
  const model = options.model ?? "claude-sonnet-4-20250514";
  const maxTokensPerResponse = options.maxTokensPerResponse ?? 16384;

  // Create Anthropic client (reads ANTHROPIC_API_KEY from env)
  // maxRetries: 0 disables SDK built-in retries -- let Temporal handle retries
  const client = new Anthropic({ maxRetries: 0 });

  // Convert tools to Anthropic API format
  const anthropicTools = tools.map(toAnthropicTool);

  // Initialize conversation with the initial user message
  const conversationMessages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildInitialMessage(initialMessage, context),
    },
  ];

  // Counters
  let iterationCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;
  let lastTextOutput = "";

  // Trace
  const trace: TraceStep[] = [];

  // Main loop
  while (iterationCount < maxIterations) {
    // LOOP-06: Check abort signal at top of each iteration
    if (abortSignal?.aborted) {
      return buildResult({
        status: "aborted",
        output: lastTextOutput,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        trace,
      });
    }

    // LOOP-05: Check token budget before making an LLM call
    // (1) HARD STOP: absolute zero tokens left -- no further LLM calls
    if (tokenBudget?.isExhausted()) {
      return buildResult({
        status: "max_tokens",
        output: lastTextOutput,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        trace,
      });
    }

    // (2) RESERVE GATE: only reserve buffer remains -- graceful wrap-up
    // Make one final LLM call with a wrap-up instruction, then stop.
    // Skip on first iteration (iterationCount === 0) to allow at least one normal call.
    if (tokenBudget?.isReserveOnly() && iterationCount > 0) {
      conversationMessages.push({
        role: "user",
        content:
          "[SYSTEM] Token budget nearly exhausted. Provide a brief summary of progress so far and what remains to be done, so work can be resumed later.",
      });

      try {
        const finalResponse = await client.messages.create(
          {
            model,
            max_tokens: maxTokensPerResponse,
            system: systemPrompt,
            messages: conversationMessages,
          },
          { signal: abortSignal },
        );

        // Deduct tokens from the final response
        totalInputTokens += finalResponse.usage.input_tokens;
        totalOutputTokens += finalResponse.usage.output_tokens;
        tokenBudget.deduct(
          finalResponse.usage.input_tokens,
          finalResponse.usage.output_tokens,
        );

        // Record final trace step
        const finalTraceStep: TraceStep = {
          type: "llm_response",
          timestamp: new Date().toISOString(),
          tokenCount: {
            input: finalResponse.usage.input_tokens,
            output: finalResponse.usage.output_tokens,
          },
        };
        if (finalResponse.stop_reason) {
          finalTraceStep.stopReason = finalResponse.stop_reason;
        }
        trace.push(finalTraceStep);

        const wrapUpText = extractTextOutput(finalResponse.content);
        return buildResult({
          status: "max_tokens",
          output: wrapUpText || lastTextOutput,
          toolCallCount,
          totalInputTokens,
          totalOutputTokens,
          trace,
        });
      } catch {
        // If the wrap-up call fails, return with what we have
        return buildResult({
          status: "max_tokens",
          output: lastTextOutput,
          toolCallCount,
          totalInputTokens,
          totalOutputTokens,
          trace,
        });
      }
    }

    // LOOP-02: Call the LLM
    let response: Anthropic.Message;
    const callStartTime = performance.now();

    try {
      const createParams: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokensPerResponse,
        system: systemPrompt,
        messages: conversationMessages,
      };

      // Only include tools if we have any
      if (anthropicTools.length > 0) {
        createParams.tools = anthropicTools;
      }

      response = await client.messages.create(createParams, {
        signal: abortSignal,
      });
    } catch (error: unknown) {
      // Handle abort via AbortSignal
      if (error instanceof Error && error.name === "AbortError") {
        return buildResult({
          status: "aborted",
          output: lastTextOutput,
          toolCallCount,
          totalInputTokens,
          totalOutputTokens,
          trace,
        });
      }

      // Handle Anthropic API errors
      if (error instanceof Anthropic.APIError) {
        const errorMessage = `Anthropic API error: ${error.message}`;
        logger?.error({ err: error, status: error.status }, errorMessage);
        return buildResult({
          status: "error",
          output: errorMessage,
          toolCallCount,
          totalInputTokens,
          totalOutputTokens,
          trace,
        });
      }

      // Handle other errors
      const errorMessage =
        error instanceof Error
          ? `Agent loop error: ${error.message}`
          : "Agent loop error: unknown error";
      logger?.error({ err: error }, errorMessage);
      return buildResult({
        status: "error",
        output: errorMessage,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        trace,
      });
    }

    const callDurationMs = performance.now() - callStartTime;

    // Track token usage (LOOP-05)
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    tokenBudget?.deduct(
      response.usage.input_tokens,
      response.usage.output_tokens,
    );

    // GUAR-03: Check warning threshold (fires once)
    if (tokenBudget?.isWarning() && !tokenBudget.warningFired) {
      tokenBudget.warningFired = true;
      onBudgetWarning?.({
        total: tokenBudget.total,
        remaining: tokenBudget.remaining,
        usedPercent: Math.round(
          ((tokenBudget.total - tokenBudget.remaining) / tokenBudget.total) *
            100,
        ),
      });
    }

    // Record LLM response trace step
    const llmTraceStep: TraceStep = {
      type: "llm_response",
      timestamp: new Date().toISOString(),
      tokenCount: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      durationMs: Math.round(callDurationMs),
    };
    if (response.stop_reason) {
      llmTraceStep.stopReason = response.stop_reason;
    }
    trace.push(llmTraceStep);

    // LOOP-07: Fire onResponse callback
    onResponse?.(response);

    // Fire heartbeat callback after each LLM response (for Temporal activity heartbeats)
    onHeartbeat?.();

    // LOOP-09: Handle non-tool-use stop reasons (terminal)
    if (response.stop_reason !== "tool_use") {
      const textOutput = extractTextOutput(response.content);
      const status = mapStopReasonToStatus(response.stop_reason, logger);
      return buildResult({
        status,
        output: textOutput,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        trace,
      });
    }

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    // Add assistant message to conversation (full content including text + tool_use)
    conversationMessages.push({
      role: "assistant",
      content: response.content,
    });

    // Execute tools and collect results (LOOP-01, LOOP-03)
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // Check abort signal before each tool execution (LOOP-06)
      if (abortSignal?.aborted) {
        return buildResult({
          status: "aborted",
          output: lastTextOutput,
          toolCallCount,
          totalInputTokens,
          totalOutputTokens,
          trace,
        });
      }

      // LOOP-07: Fire onToolCall callback
      onToolCall?.({
        name: toolUse.name,
        input: toolUse.input,
        id: toolUse.id,
      });

      // Record tool_call trace step
      trace.push({
        type: "tool_call",
        timestamp: new Date().toISOString(),
        toolName: toolUse.name,
        toolCallId: toolUse.id,
        input: toolUse.input,
      });

      // Find matching tool definition
      const toolDef = tools.find((t) => t.name === toolUse.name);

      let result: ToolResult;
      const toolStartTime = performance.now();

      if (!toolDef) {
        // Unknown tool -- send error back to LLM
        result = {
          content: `Unknown tool: ${toolUse.name}`,
          isError: true,
        };
      } else {
        try {
          result = await toolDef.execute(toolUse.input);
        } catch (error: unknown) {
          // Tool execution error -- send back to LLM for reasoning
          const message =
            error instanceof Error ? error.message : "Unknown execution error";
          result = {
            content: `Tool execution error: ${message}`,
            isError: true,
          };
          logger?.warn(
            { err: error, toolName: toolUse.name },
            "Tool execution failed, sending error to LLM",
          );
        }
      }

      const toolDurationMs = performance.now() - toolStartTime;

      // Record tool_result trace step
      trace.push({
        type: "tool_result",
        timestamp: new Date().toISOString(),
        toolName: toolUse.name,
        toolCallId: toolUse.id,
        output: result.content,
        durationMs: Math.round(toolDurationMs),
      });

      // Build tool result block for the API
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError ?? false,
      });
    }

    // Count all parallel tool calls in this iteration
    toolCallCount += toolUseBlocks.length;

    // Add tool results as a SINGLE user message with ONLY tool_result blocks.
    // CRITICAL: Do NOT add text blocks alongside tool_result blocks --
    // this causes empty LLM responses (research pitfall #1).
    conversationMessages.push({
      role: "user",
      content: toolResults,
    });

    // Update last text output from this response (for partial results on early exit)
    const iterationText = extractTextOutput(response.content);
    if (iterationText) {
      lastTextOutput = iterationText;
    }

    // Increment iteration counter
    iterationCount++;
  }

  // Loop exited naturally: max iterations reached (LOOP-04)
  return buildResult({
    status: "max_iterations",
    output: lastTextOutput,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
    trace,
  });
}
