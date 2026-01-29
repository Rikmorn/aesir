/**
 * Tests for runAgentLoop()
 *
 * Comprehensive tests covering all requirements:
 * - LOOP-01: Full tool-use loop lifecycle
 * - LOOP-02: Anthropic SDK native tool-use
 * - LOOP-03: betaZodTool Zod-to-JSON-Schema conversion
 * - LOOP-04: Iteration limit enforcement
 * - LOOP-05: Token budget tracking and enforcement
 * - LOOP-06: AbortSignal cancellation
 * - LOOP-07: onToolCall and onResponse callbacks
 * - LOOP-08: Structured result return
 * - LOOP-09: All stop_reason values handled
 */

import type { PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTokenBudget } from "./token-budget.js";
import type { AgentLoopOptions, ToolDefinition, ToolResult } from "./types.js";

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // Provide the APIError class for instanceof checks
  class APIError extends Error {
    status: number;
    headers: undefined;
    error: unknown;
    constructor(
      status: number,
      error: unknown,
      message: string,
      _headers: undefined,
    ) {
      super(message || `API Error ${status}`);
      this.name = "APIError";
      this.status = status;
      this.error = error;
    }
  }

  // Use a class so it's constructable with `new`
  class MockAnthropic {
    // biome-ignore lint/style/useNamingConvention: Must match Anthropic SDK's exported name
    static APIError = APIError;
    messages = { create: mockCreate };
  }

  return { default: MockAnthropic, APIError };
});

// Mock betaZodTool to pass-through the schema as JSON-like object
vi.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (opts: {
    name: string;
    inputSchema: z.ZodType;
    description: string;
  }) => ({
    type: "custom",
    name: opts.name,
    description: opts.description,
    input_schema: { type: "object", properties: {} },
    run: async () => "",
    parse: (args: unknown) => args,
  }),
}));

// Import AFTER mocks are set up
const { runAgentLoop } = await import("./run-agent-loop.js");

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function mockTextResponse(
  text: string,
  inputTokens = 100,
  outputTokens = 50,
  stopReason: string | null = "end_turn",
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function mockToolUseResponse(
  toolCalls: Array<{ name: string; input: unknown; id: string }>,
  inputTokens = 100,
  outputTokens = 50,
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    })),
    stop_reason: "tool_use",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function mockMixedResponse(
  text: string,
  toolCalls: Array<{ name: string; input: unknown; id: string }>,
  inputTokens = 100,
  outputTokens = 50,
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text },
      ...toolCalls.map((tc) => ({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function createTestTool(
  name: string,
  handler?: (input: unknown) => Promise<ToolResult>,
): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({ value: z.string().describe("Test value") }),
    execute: handler ?? (async () => ({ content: `${name} result` })),
  };
}

/** Helper to get a mock call by index with type safety. */
function getMockCall(index: number): [Record<string, unknown>, ...unknown[]] {
  const call = mockCreate.mock.calls[index] as
    | [Record<string, unknown>, ...unknown[]]
    | undefined;
  if (!call) throw new Error(`No mock call at index ${index}`);
  return call;
}

/** Get messages from a mock call. */
function getMessagesFromCall(
  index: number,
): Array<{ role: string; content: unknown }> {
  const call = getMockCall(index);
  return (call[0] as Record<string, unknown>).messages as Array<{
    role: string;
    content: unknown;
  }>;
}

/** Get the last message from a mock call (safe, throws if missing). */
function getLastMessage(callIndex: number): {
  role: string;
  content: unknown;
} {
  const messages = getMessagesFromCall(callIndex);
  const last = messages[messages.length - 1];
  if (!last) throw new Error("No messages found");
  return last;
}

/** Get message at specific index from a mock call (safe, throws if missing). */
function getMessageAt(
  callIndex: number,
  msgIndex: number,
): { role: string; content: unknown } {
  const messages = getMessagesFromCall(callIndex);
  const msg = messages[msgIndex];
  if (!msg) throw new Error(`No message at index ${msgIndex}`);
  return msg;
}

function createMockLogger(): PinoLogger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: "info",
  } as unknown as PinoLogger;
}

function baseOptions(overrides?: Partial<AgentLoopOptions>): AgentLoopOptions {
  return {
    systemPrompt: "You are a test agent.",
    tools: [],
    initialMessage: "Do the task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentLoop", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. Basic completion (LOOP-01, LOOP-08)
  // -------------------------------------------------------------------------

  it("completes when LLM responds with text only (no tools)", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Hello world"));

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Hello world");
    expect(result.toolCallCount).toBe(0);
    expect(result.tokenCount.input).toBe(100);
    expect(result.tokenCount.output).toBe(50);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]?.type).toBe("llm_response");
  });

  // -------------------------------------------------------------------------
  // 2. Tool execution and feedback (LOOP-01)
  // -------------------------------------------------------------------------

  it("executes tool and feeds result back to LLM", async () => {
    const executeFn = vi.fn().mockResolvedValue({ content: "tool output" });
    const tool = createTestTool("my_tool", executeFn);

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "my_tool", input: { value: "test" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Done with tool"));

    const result = await runAgentLoop(baseOptions({ tools: [tool] }));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Done with tool");
    expect(result.toolCallCount).toBe(1);
    expect(executeFn).toHaveBeenCalledWith({ value: "test" });

    // Verify conversation structure: 2 calls to messages.create
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 3. Parallel tool calls (LOOP-01, research pitfall #3)
  // -------------------------------------------------------------------------

  it("handles parallel tool calls in single response", async () => {
    const tool1 = createTestTool("tool_a");
    const tool2 = createTestTool("tool_b");

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "tool_a", input: { value: "a" }, id: "call_a" },
          { name: "tool_b", input: { value: "b" }, id: "call_b" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Both tools done"));

    const result = await runAgentLoop(baseOptions({ tools: [tool1, tool2] }));

    expect(result.status).toBe("completed");
    expect(result.toolCallCount).toBe(2);

    // Verify both tool results sent in a single user message
    const lastUserMessage = getLastMessage(1);
    expect(lastUserMessage.role).toBe("user");
    const content = lastUserMessage.content as Array<{ type: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("tool_result");
    expect(content[1]?.type).toBe("tool_result");
  });

  // -------------------------------------------------------------------------
  // 4. Max iterations limit (LOOP-04)
  // -------------------------------------------------------------------------

  it("stops at max iterations limit", async () => {
    const tool = createTestTool("loop_tool");

    // Always return tool_use (infinite loop)
    mockCreate.mockResolvedValue(
      mockToolUseResponse([
        { name: "loop_tool", input: { value: "loop" }, id: "call_loop" },
      ]),
    );

    const result = await runAgentLoop(
      baseOptions({ tools: [tool], maxIterations: 3 }),
    );

    expect(result.status).toBe("max_iterations");
    expect(result.toolCallCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 5. Token budget exhaustion (LOOP-05)
  // -------------------------------------------------------------------------

  it("stops when token budget exhausted", async () => {
    const tool = createTestTool("budget_tool");
    const budget = createTokenBudget(200);

    // First call: uses 150 tokens, budget now 50
    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse(
          [{ name: "budget_tool", input: { value: "x" }, id: "call_1" }],
          100,
          50,
        ),
      )
      // Second iteration: budget check sees 50 remaining. This call
      // uses another 150 tokens, budget now -100.
      .mockResolvedValueOnce(
        mockToolUseResponse(
          [{ name: "budget_tool", input: { value: "x" }, id: "call_2" }],
          100,
          50,
        ),
      )
      // Third iteration: budget is -100, isExhausted returns true
      .mockResolvedValueOnce(mockTextResponse("Should not reach this"));

    const result = await runAgentLoop(
      baseOptions({ tools: [tool], tokenBudget: budget }),
    );

    expect(result.status).toBe("max_tokens");
    expect(budget.remaining).toBeLessThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 6. Token budget sharing (LOOP-05)
  // -------------------------------------------------------------------------

  it("shares token budget across calls (mutable)", async () => {
    const budget = createTokenBudget(500);

    // Single text response using 150 tokens
    mockCreate.mockResolvedValueOnce(mockTextResponse("Done", 100, 50));

    await runAgentLoop(baseOptions({ tokenBudget: budget }));

    expect(budget.remaining).toBe(350); // 500 - 100 - 50
  });

  // -------------------------------------------------------------------------
  // 7. AbortSignal (LOOP-06)
  // -------------------------------------------------------------------------

  it("stops when AbortSignal fires before first iteration", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runAgentLoop(
      baseOptions({ abortSignal: controller.signal }),
    );

    expect(result.status).toBe("aborted");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("stops when AbortSignal fires during tool execution", async () => {
    const controller = new AbortController();
    const tool = createTestTool("abort_tool", async () => {
      controller.abort();
      return { content: "done" };
    });

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "abort_tool", input: { value: "a" }, id: "call_a" },
          { name: "abort_tool", input: { value: "b" }, id: "call_b" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Should not reach"));

    const result = await runAgentLoop(
      baseOptions({ tools: [tool], abortSignal: controller.signal }),
    );

    expect(result.status).toBe("aborted");
  });

  // -------------------------------------------------------------------------
  // 8. onToolCall callback (LOOP-07)
  // -------------------------------------------------------------------------

  it("fires onToolCall callback for every tool call", async () => {
    const tool = createTestTool("cb_tool");
    const onToolCall = vi.fn();

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "cb_tool", input: { value: "test" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Done"));

    await runAgentLoop(baseOptions({ tools: [tool], onToolCall }));

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith({
      name: "cb_tool",
      input: { value: "test" },
      id: "call_1",
    });
  });

  // -------------------------------------------------------------------------
  // 9. onResponse callback (LOOP-07)
  // -------------------------------------------------------------------------

  it("fires onResponse callback for every LLM response", async () => {
    const tool = createTestTool("resp_tool");
    const onResponse = vi.fn();

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "resp_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Final"));

    await runAgentLoop(baseOptions({ tools: [tool], onResponse }));

    expect(onResponse).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 10. Structured result (LOOP-08)
  // -------------------------------------------------------------------------

  it("returns structured result with all fields", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Hello"));

    const result = await runAgentLoop(baseOptions());

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        output: "Hello",
        toolCallCount: 0,
        tokenCount: { input: 100, output: 50 },
        trace: expect.any(Array),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 11. end_turn stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles end_turn stop_reason", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse("end turn", 100, 50, "end_turn"),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 12. max_tokens stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles max_tokens stop_reason", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse("truncated", 100, 50, "max_tokens"),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("max_tokens");
  });

  // -------------------------------------------------------------------------
  // 13. stop_sequence stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles stop_sequence stop_reason", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse("stopped", 100, 50, "stop_sequence"),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 14. refusal stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles refusal stop_reason", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse("I cannot do that", 100, 50, "refusal"),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("error");
  });

  // -------------------------------------------------------------------------
  // 15. Unknown stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles unknown stop_reason gracefully", async () => {
    const mockLogger = createMockLogger();

    mockCreate.mockResolvedValueOnce(
      mockTextResponse("future", 100, 50, "some_future_value"),
    );

    const result = await runAgentLoop(baseOptions({ logger: mockLogger }));

    expect(result.status).toBe("completed");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { stopReason: "some_future_value" },
      expect.stringContaining("Unknown stop_reason"),
    );
  });

  // -------------------------------------------------------------------------
  // 16. Tool errors returned to LLM (TOOL-07 pattern)
  // -------------------------------------------------------------------------

  it("returns tool errors to LLM instead of throwing", async () => {
    const failTool = createTestTool("fail_tool", async () => {
      throw new Error("Tool broke");
    });

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "fail_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Handled the error"));

    const result = await runAgentLoop(baseOptions({ tools: [failTool] }));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Handled the error");

    // Verify error was sent back as tool_result with is_error
    const toolResultMsg = getLastMessage(1);
    const content = toolResultMsg.content as Array<{
      is_error: boolean;
      content: string;
    }>;
    expect(content[0]?.is_error).toBe(true);
    expect(content[0]?.content).toContain("Tool execution error");
  });

  // -------------------------------------------------------------------------
  // 17. Unknown tool name (graceful)
  // -------------------------------------------------------------------------

  it("handles unknown tool name gracefully", async () => {
    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "nonexistent_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Handled unknown tool"));

    const result = await runAgentLoop(baseOptions({ tools: [] }));

    expect(result.status).toBe("completed");

    // Verify error result sent back
    const toolResultMsg = getLastMessage(1);
    const content = toolResultMsg.content as Array<{
      is_error: boolean;
      content: string;
    }>;
    expect(content[0]?.is_error).toBe(true);
    expect(content[0]?.content).toContain("Unknown tool");
  });

  // -------------------------------------------------------------------------
  // 18. Correct conversation message format
  // -------------------------------------------------------------------------

  it("builds correct conversation message format", async () => {
    const tool = createTestTool("fmt_tool");

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "fmt_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Done"));

    await runAgentLoop(baseOptions({ tools: [tool] }));

    // The conversation array is mutable, so both calls reference the same array.
    // Check the final state of messages which reflects the full conversation.
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // After completion, the messages array has 3 entries:
    // [user, assistant (tool_use), user (tool_results)]
    const messages = getMessagesFromCall(1);
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Do the task");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.role).toBe("user");

    // User message with tool results should contain ONLY tool_result blocks (no text)
    const toolResultMessage = getMessageAt(1, 2);
    const content = toolResultMessage.content as Array<{
      type: string;
      tool_use_id: string;
    }>;
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("tool_result");
    expect(content[0]?.tool_use_id).toBe("call_1");
  });

  // -------------------------------------------------------------------------
  // 19. Context in initial message
  // -------------------------------------------------------------------------

  it("includes context in initial message when provided", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Done"));

    await runAgentLoop(
      baseOptions({
        context: "Background info",
        initialMessage: "Do the task",
      }),
    );

    const call = getMockCall(0);
    const messages = (call[0] as Record<string, unknown>).messages as Array<{
      content: string;
    }>;
    expect(messages[0]?.content).toBe("Background info\n\nDo the task");
  });

  // -------------------------------------------------------------------------
  // 20. Trace steps (LOOP-07, LOOP-08)
  // -------------------------------------------------------------------------

  it("records trace steps for all events", async () => {
    const tool = createTestTool("trace_tool");

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "trace_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Done"));

    const result = await runAgentLoop(baseOptions({ tools: [tool] }));

    // Expect: llm_response, tool_call, tool_result, llm_response
    const { trace } = result;
    expect(trace).toHaveLength(4);
    expect(trace[0]?.type).toBe("llm_response");
    expect(trace[1]?.type).toBe("tool_call");
    expect(trace[2]?.type).toBe("tool_result");
    expect(trace[3]?.type).toBe("llm_response");

    // Each trace step has timestamp
    for (const step of trace) {
      expect(step.timestamp).toBeDefined();
      expect(typeof step.timestamp).toBe("string");
    }

    // LLM response steps have token counts
    expect(trace[0]?.tokenCount).toEqual({ input: 100, output: 50 });
    expect(trace[0]?.durationMs).toBeDefined();
    expect(trace[0]?.stopReason).toBe("tool_use");

    // Tool call step has tool info
    expect(trace[1]?.toolName).toBe("trace_tool");
    expect(trace[1]?.toolCallId).toBe("call_1");
    expect(trace[1]?.input).toEqual({ value: "x" });

    // Tool result step has output
    expect(trace[2]?.toolName).toBe("trace_tool");
    expect(trace[2]?.output).toBe("trace_tool result");
    expect(trace[2]?.durationMs).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 21. betaZodTool schema conversion (LOOP-03)
  // -------------------------------------------------------------------------

  it("uses betaZodTool for schema conversion (Anthropic format)", async () => {
    const tool = createTestTool("schema_tool");

    mockCreate.mockResolvedValueOnce(mockTextResponse("Done"));

    await runAgentLoop(baseOptions({ tools: [tool] }));

    // Verify the tools passed to messages.create have Anthropic format
    const call = getMockCall(0);
    const tools = (call[0] as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual(
      expect.objectContaining({
        name: "schema_tool",
        description: "Test tool: schema_tool",
        input_schema: expect.objectContaining({ type: "object" }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Additional: Anthropic API error handling
  // -------------------------------------------------------------------------

  it("handles Anthropic API errors gracefully", async () => {
    // Import APIError from the mocked SDK
    const { APIError } = await import("@anthropic-ai/sdk");
    mockCreate.mockRejectedValueOnce(
      new (
        APIError as unknown as new (
          s: number,
          e: unknown,
          m: string,
          h: undefined,
        ) => Error
      )(500, { message: "Server error" }, "Server error", undefined),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("error");
    expect(result.output).toContain("Anthropic API error");
  });

  // -------------------------------------------------------------------------
  // Additional: AbortError during API call
  // -------------------------------------------------------------------------

  it("handles AbortError during API call", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockCreate.mockRejectedValueOnce(abortError);

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("aborted");
  });

  // -------------------------------------------------------------------------
  // Additional: model_context_window_exceeded stop_reason (LOOP-09)
  // -------------------------------------------------------------------------

  it("handles model_context_window_exceeded stop_reason", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse(
        "context exceeded",
        100,
        50,
        "model_context_window_exceeded",
      ),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("max_tokens");
  });

  // -------------------------------------------------------------------------
  // Additional: null stop_reason
  // -------------------------------------------------------------------------

  it("handles null stop_reason as completed", async () => {
    mockCreate.mockResolvedValueOnce(
      mockTextResponse("null reason", 100, 50, null),
    );

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // Additional: structuredOutput parsing
  // -------------------------------------------------------------------------

  it("parses JSON output as structuredOutput", async () => {
    const jsonOutput = JSON.stringify({ key: "value", count: 42 });
    mockCreate.mockResolvedValueOnce(mockTextResponse(jsonOutput));

    const result = await runAgentLoop(baseOptions());

    expect(result.structuredOutput).toEqual({ key: "value", count: 42 });
  });

  it("leaves structuredOutput undefined for non-JSON output", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Plain text output"));

    const result = await runAgentLoop(baseOptions());

    expect(result.structuredOutput).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Additional: Tools not included when empty
  // -------------------------------------------------------------------------

  it("does not include tools param when tools array is empty", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("No tools"));

    await runAgentLoop(baseOptions({ tools: [] }));

    const call = getMockCall(0);
    expect((call[0] as Record<string, unknown>).tools).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Additional: Default model and max tokens
  // -------------------------------------------------------------------------

  it("uses default model and max tokens when not specified", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Defaults"));

    await runAgentLoop(baseOptions());

    const call = getMockCall(0);
    const params = call[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-4-20250514");
    expect(params.max_tokens).toBe(16384);
  });

  it("uses custom model and max tokens when specified", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Custom"));

    await runAgentLoop(
      baseOptions({
        model: "claude-opus-4-20250514",
        maxTokensPerResponse: 4096,
      }),
    );

    const call = getMockCall(0);
    const params = call[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-4-20250514");
    expect(params.max_tokens).toBe(4096);
  });

  // -------------------------------------------------------------------------
  // Additional: system prompt passed correctly
  // -------------------------------------------------------------------------

  it("passes system prompt to messages.create", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Done"));

    await runAgentLoop(baseOptions({ systemPrompt: "Be helpful" }));

    const call = getMockCall(0);
    expect((call[0] as Record<string, unknown>).system).toBe("Be helpful");
  });

  // -------------------------------------------------------------------------
  // Additional: Multiple tool iterations
  // -------------------------------------------------------------------------

  it("handles multiple tool iterations correctly", async () => {
    const tool = createTestTool("multi_tool");
    const onToolCall = vi.fn();

    mockCreate
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "multi_tool", input: { value: "first" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(
        mockToolUseResponse([
          { name: "multi_tool", input: { value: "second" }, id: "call_2" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("All done"));

    const result = await runAgentLoop(
      baseOptions({ tools: [tool], onToolCall }),
    );

    expect(result.status).toBe("completed");
    expect(result.toolCallCount).toBe(2);
    expect(result.output).toBe("All done");
    expect(onToolCall).toHaveBeenCalledTimes(2);

    // Token counts should be cumulative
    expect(result.tokenCount.input).toBe(300); // 3 calls * 100
    expect(result.tokenCount.output).toBe(150); // 3 calls * 50
  });

  // -------------------------------------------------------------------------
  // Additional: Generic error handling
  // -------------------------------------------------------------------------

  it("handles generic errors during API call", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network failure"));

    const result = await runAgentLoop(baseOptions());

    expect(result.status).toBe("error");
    expect(result.output).toContain("Agent loop error");
    expect(result.output).toContain("Network failure");
  });

  // -------------------------------------------------------------------------
  // Additional: Mixed text + tool_use response
  // -------------------------------------------------------------------------

  it("handles response with both text and tool_use blocks", async () => {
    const tool = createTestTool("mixed_tool");

    mockCreate
      .mockResolvedValueOnce(
        mockMixedResponse("Thinking...", [
          { name: "mixed_tool", input: { value: "x" }, id: "call_1" },
        ]),
      )
      .mockResolvedValueOnce(mockTextResponse("Final answer"));

    const result = await runAgentLoop(baseOptions({ tools: [tool] }));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Final answer");
    expect(result.toolCallCount).toBe(1);
  });
});
