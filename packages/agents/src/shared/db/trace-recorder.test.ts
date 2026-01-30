/**
 * Trace Recorder Tests
 *
 * Tests for createTraceRecorder() covering: callback buffering, step numbering,
 * token count extraction, truncation, batch flush, best-effort error handling,
 * parent/child correlation, and callback signature compatibility with runAgentLoop().
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMResponse, ToolCallInfo } from "../agent-loop/types.js";
import type { NewExecutionTrace } from "./schema.js";
import {
  createTraceRecorder,
  type TraceRecorderOptions,
} from "./trace-recorder.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockDb() {
  const valuesFn = vi.fn().mockResolvedValue(undefined);
  return {
    insert: vi.fn().mockReturnValue({ values: valuesFn }),
    mockValuesFn: valuesFn,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    level: "info",
  };
}

function createMockToolCall(overrides?: Partial<ToolCallInfo>): ToolCallInfo {
  return {
    name: "read_file",
    input: { path: "/foo.ts" },
    id: "tool_123",
    ...overrides,
  };
}

function createMockResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    id: "msg_test123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  } as LLMResponse;
}

function createDefaultOptions(
  overrides?: Partial<TraceRecorderOptions>,
): TraceRecorderOptions {
  return {
    db: createMockDb() as unknown as TraceRecorderOptions["db"],
    logger: createMockLogger() as unknown as TraceRecorderOptions["logger"],
    taskId: "task_abc123",
    workflowId: "wf_xyz789",
    agentType: "dev-orchestrator",
    agentInstanceId: "inst_001",
    ...overrides,
  };
}

/**
 * Extract inserted records from mock db after flush.
 */
function getInsertedRecords(
  mockDb: ReturnType<typeof createMockDb>,
): NewExecutionTrace[] {
  const calls = mockDb.mockValuesFn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as NewExecutionTrace[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTraceRecorder", () => {
  it("throws if db is missing", () => {
    expect(() =>
      createTraceRecorder({
        ...createDefaultOptions(),
        db: undefined as unknown as TraceRecorderOptions["db"],
      }),
    ).toThrow("db is required for TraceRecorder");
  });

  it("throws if logger is missing", () => {
    expect(() =>
      createTraceRecorder({
        ...createDefaultOptions(),
        logger: undefined as unknown as TraceRecorderOptions["logger"],
      }),
    ).toThrow("logger is required for TraceRecorder");
  });

  it("throws if taskId is missing", () => {
    expect(() =>
      createTraceRecorder({
        ...createDefaultOptions(),
        taskId: "",
      }),
    ).toThrow("taskId is required for TraceRecorder");
  });

  it("throws if agentInstanceId is missing", () => {
    expect(() =>
      createTraceRecorder({
        ...createDefaultOptions(),
        agentInstanceId: "",
      }),
    ).toThrow("agentInstanceId is required for TraceRecorder");
  });
});

describe("onToolCall", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let recorder: ReturnType<typeof createTraceRecorder>;

  beforeEach(() => {
    mockDb = createMockDb();
    recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
      }),
    );
  });

  it("buffers a tool_call trace step", async () => {
    recorder.onToolCall(createMockToolCall());

    expect(recorder.stepCount()).toBe(1);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "tool_call",
      tool_name: "read_file",
      input: { path: "/foo.ts" },
      output: null,
      token_count_input: null,
      token_count_output: null,
      task_id: "task_abc123",
      workflow_id: "wf_xyz789",
      agent_type: "dev-orchestrator",
      agent_instance_id: "inst_001",
      step_number: 1,
    });
    // ID should have trace_ prefix
    expect(records[0]?.id).toMatch(/^trace_/);
  });

  it("increments step counter on each call", async () => {
    recorder.onToolCall(createMockToolCall({ name: "tool_a", id: "t1" }));
    recorder.onToolCall(createMockToolCall({ name: "tool_b", id: "t2" }));

    expect(recorder.stepCount()).toBe(2);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(2);
    expect(records[0]?.step_number).toBe(1);
    expect(records[1]?.step_number).toBe(2);
  });

  it("truncates large input payloads", async () => {
    const largeInput = { data: "x".repeat(20_000) };
    recorder.onToolCall(
      createMockToolCall({ name: "big_tool", input: largeInput }),
    );

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    const input = records[0]?.input as {
      truncated: boolean;
      preview: string;
    };
    expect(input.truncated).toBe(true);
    expect(input.preview.length).toBeLessThanOrEqual(10240 + 100); // some slack for JSON overhead
  });
});

describe("onResponse", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let recorder: ReturnType<typeof createTraceRecorder>;

  beforeEach(() => {
    mockDb = createMockDb();
    recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
      }),
    );
  });

  it("buffers an llm_response trace step with token counts", async () => {
    const response = createMockResponse({
      usage: {
        input_tokens: 500,
        output_tokens: 200,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      },
    });
    recorder.onResponse(response);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "llm_response",
      tool_name: null,
      input: null,
      token_count_input: 500,
      token_count_output: 200,
      duration_ms: null,
    });
  });

  it("extracts text output from content blocks", async () => {
    const response = createMockResponse({
      content: [
        { type: "text", text: "First part" },
        { type: "text", text: "Second part" },
      ],
    } as Partial<LLMResponse>);
    recorder.onResponse(response);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.output).toBe("First part\nSecond part");
  });

  it("handles responses with tool_use content blocks", async () => {
    const response = createMockResponse({
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "read_file",
          input: { path: "/foo.ts" },
        },
      ],
    } as Partial<LLMResponse>);
    recorder.onResponse(response);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe("llm_response");
    // tool_use blocks are not text, so output should be empty string
    expect(records[0]?.output).toBe("");
  });
});

describe("onAgentSpawn", () => {
  it("buffers an agent_spawn trace step", async () => {
    const mockDb = createMockDb();
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
      }),
    );

    recorder.onAgentSpawn("child_123", "researcher", {
      task: "research auth",
    });

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "agent_spawn",
      tool_name: "researcher",
      input: { task: "research auth" },
      output: null,
    });
  });
});

describe("onAgentComplete", () => {
  it("buffers an agent_complete trace step", async () => {
    const mockDb = createMockDb();
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
      }),
    );

    recorder.onAgentComplete({ status: "completed", output: "Done" });

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "agent_complete",
      tool_name: null,
      input: null,
      output: { status: "completed", output: "Done" },
    });
  });
});

describe("flush", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
  });

  it("inserts all buffered records in a single batch", async () => {
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        logger: mockLogger as unknown as TraceRecorderOptions["logger"],
      }),
    );

    recorder.onToolCall(createMockToolCall({ name: "tool_a", id: "t1" }));
    recorder.onToolCall(createMockToolCall({ name: "tool_b", id: "t2" }));
    recorder.onResponse(createMockResponse());

    await recorder.flush();

    // db.insert called once
    expect(mockDb.insert).toHaveBeenCalledOnce();
    // values() called with all 3 records
    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(3);
  });

  it("clears buffer after flush", async () => {
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        logger: mockLogger as unknown as TraceRecorderOptions["logger"],
      }),
    );

    recorder.onToolCall(createMockToolCall());
    await recorder.flush();

    // Reset mock to track second call
    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();

    // Second flush should be a no-op
    await recorder.flush();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does not throw on database error (best-effort)", async () => {
    mockDb.mockValuesFn.mockRejectedValueOnce(new Error("Connection refused"));
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        logger: mockLogger as unknown as TraceRecorderOptions["logger"],
      }),
    );

    recorder.onToolCall(createMockToolCall());

    // Should NOT throw
    await expect(recorder.flush()).resolves.toBeUndefined();

    // Should have logged the error
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        stepCount: 1,
      }),
      "Failed to flush trace steps to database",
    );
  });

  it("clears buffer even on database error", async () => {
    // First flush will fail
    mockDb.mockValuesFn.mockRejectedValueOnce(new Error("Connection refused"));
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        logger: mockLogger as unknown as TraceRecorderOptions["logger"],
      }),
    );

    recorder.onToolCall(createMockToolCall({ name: "tool_a", id: "t1" }));
    await recorder.flush();

    // stepCount still reflects all calls made
    expect(recorder.stepCount()).toBe(1);

    // Reset for second flush -- this one succeeds
    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();
    mockDb.mockValuesFn.mockResolvedValueOnce(undefined);

    recorder.onToolCall(createMockToolCall({ name: "tool_b", id: "t2" }));
    await recorder.flush();

    // Only the new record should be inserted
    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
    expect(records[0]?.tool_name).toBe("tool_b");
  });

  it("is a no-op when buffer is empty", async () => {
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        logger: mockLogger as unknown as TraceRecorderOptions["logger"],
      }),
    );

    await recorder.flush();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("parent/child correlation", () => {
  it("includes parent_agent_instance_id when provided", async () => {
    const mockDb = createMockDb();
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        parentAgentInstanceId: "parent_123",
      }),
    );

    recorder.onToolCall(createMockToolCall());
    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.parent_agent_instance_id).toBe("parent_123");
  });

  it("sets parent_agent_instance_id to null for root agents", async () => {
    const mockDb = createMockDb();
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
        // No parentAgentInstanceId
      }),
    );

    recorder.onToolCall(createMockToolCall());
    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.parent_agent_instance_id).toBeNull();
  });
});

describe("step numbering", () => {
  it("numbers steps sequentially across different callback types", async () => {
    const mockDb = createMockDb();
    const recorder = createTraceRecorder(
      createDefaultOptions({
        db: mockDb as unknown as TraceRecorderOptions["db"],
      }),
    );

    recorder.onToolCall(createMockToolCall({ name: "step1", id: "t1" }));
    recorder.onResponse(createMockResponse());
    recorder.onAgentSpawn("child_1", "researcher", { task: "analyze" });
    recorder.onToolCall(createMockToolCall({ name: "step4", id: "t2" }));
    recorder.onAgentComplete({ status: "done" });

    expect(recorder.stepCount()).toBe(5);

    await recorder.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(5);
    expect(records[0]?.step_number).toBe(1);
    expect(records[1]?.step_number).toBe(2);
    expect(records[2]?.step_number).toBe(3);
    expect(records[3]?.step_number).toBe(4);
    expect(records[4]?.step_number).toBe(5);

    // Verify types are in expected order
    expect(records[0]?.type).toBe("tool_call");
    expect(records[1]?.type).toBe("llm_response");
    expect(records[2]?.type).toBe("agent_spawn");
    expect(records[3]?.type).toBe("tool_call");
    expect(records[4]?.type).toBe("agent_complete");
  });
});

describe("integration pattern", () => {
  it("works with runAgentLoop callback signatures", () => {
    const recorder = createTraceRecorder(createDefaultOptions());

    // Verify onToolCall accepts ToolCallInfo
    const toolCall: ToolCallInfo = {
      name: "read_file",
      input: { path: "/foo.ts" },
      id: "tool_abc",
    };
    recorder.onToolCall(toolCall);

    // Verify onResponse accepts LLMResponse (Anthropic.Message)
    const response = createMockResponse();
    recorder.onResponse(response);

    // Both callbacks ran without error, step count reflects both
    expect(recorder.stepCount()).toBe(2);
  });
});
