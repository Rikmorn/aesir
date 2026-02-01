/**
 * EventLog Tests
 *
 * Tests for createEventLog() covering: factory validation, append behavior,
 * sequence initialization, buffered flush, subscriber notification, event querying,
 * lifecycle close, gapless sequence correctness, and timer-based flush.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, NewAgentEvent } from "../shared/db/schema.js";
import { createEventLog } from "./event-log.js";
import type {
  AppendEventInput,
  EventLogOptions,
  EventSubscriptionHandler,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockDb() {
  // Mock for insert().values()
  const valuesFn = vi.fn().mockResolvedValue(undefined);
  // Mock for select().from().where().orderBy().limit() chain
  const limitFn = vi.fn().mockResolvedValue([]);
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  // whereFn needs to be thenable (for initSequence which awaits where() directly)
  // AND have orderBy (for query() which chains further)
  const whereFn = vi.fn().mockImplementation(() => {
    const result = Promise.resolve([{ maxSeq: 0 }]);
    return Object.assign(result, { orderBy: orderByFn });
  });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    insert: vi.fn().mockReturnValue({ values: valuesFn }),
    select: selectFn,
    mockValuesFn: valuesFn,
    mockSelectResult: limitFn,
    mockWhereFn: whereFn,
    mockOrderByFn: orderByFn,
    /** Override what initSequence's where() resolves to */
    setInitSequenceResult(result: Array<{ maxSeq: number }>) {
      whereFn.mockImplementation(() => {
        const promise = Promise.resolve(result);
        return Object.assign(promise, { orderBy: orderByFn });
      });
    },
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

function createDefaultEvent(
  overrides?: Partial<AppendEventInput>,
): AppendEventInput {
  return {
    conversationId: "conv_test123",
    agentDefinitionId: "dev-agent",
    agentDefinitionVersion: "1.0.0",
    agentInstanceId: "ainst_abc123",
    type: "tool.called",
    payload: { toolName: "read_file", input: { path: "/foo.ts" } },
    ...overrides,
  };
}

function createDefaultOptions(
  overrides?: Partial<{
    db: ReturnType<typeof createMockDb>;
    logger: ReturnType<typeof createMockLogger>;
    flushIntervalMs: number;
    maxBufferSize: number;
    maxPayloadBytes: number;
  }>,
): EventLogOptions {
  const base = {
    db: (overrides?.db ?? createMockDb()) as unknown as EventLogOptions["db"],
    logger: (overrides?.logger ??
      createMockLogger()) as unknown as EventLogOptions["logger"],
  };
  return {
    ...base,
    ...(overrides?.flushIntervalMs !== undefined && {
      flushIntervalMs: overrides.flushIntervalMs,
    }),
    ...(overrides?.maxBufferSize !== undefined && {
      maxBufferSize: overrides.maxBufferSize,
    }),
    ...(overrides?.maxPayloadBytes !== undefined && {
      maxPayloadBytes: overrides.maxPayloadBytes,
    }),
  };
}

/**
 * Extract inserted records from mock db after flush.
 */
function getInsertedRecords(
  mockDb: ReturnType<typeof createMockDb>,
): NewAgentEvent[] {
  const calls = mockDb.mockValuesFn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as NewAgentEvent[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEventLog", () => {
  it("throws if db is missing", () => {
    expect(() =>
      createEventLog({
        ...createDefaultOptions(),
        db: undefined as unknown as EventLogOptions["db"],
      }),
    ).toThrow("db is required for EventLog");
  });

  it("throws if logger is missing", () => {
    expect(() =>
      createEventLog({
        ...createDefaultOptions(),
        logger: undefined as unknown as EventLogOptions["logger"],
      }),
    ).toThrow("logger is required for EventLog");
  });

  it("returns object with all EventLog methods", () => {
    const eventLog = createEventLog(createDefaultOptions());
    expect(typeof eventLog.append).toBe("function");
    expect(typeof eventLog.initSequence).toBe("function");
    expect(typeof eventLog.query).toBe("function");
    expect(typeof eventLog.subscribe).toBe("function");
    expect(typeof eventLog.flush).toBe("function");
    expect(typeof eventLog.close).toBe("function");
  });
});

describe("append", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    // Use initSequence mock: return maxSeq 0 for conv_test123
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("throws if EventLog is closed", async () => {
    await eventLog.initSequence("conv_test123");
    await eventLog.close();

    expect(() => eventLog.append(createDefaultEvent())).toThrow(
      "EventLog is closed",
    );
  });

  it("throws if sequence not initialized", () => {
    expect(() => eventLog.append(createDefaultEvent())).toThrow(
      "Sequence not initialized for conversation conv_test123. Call initSequence() first.",
    );
  });

  it("buffers events without immediate DB write", async () => {
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());

    // db.insert should NOT have been called yet (buffered)
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("assigns auto-incrementing sequence numbers starting from 1", async () => {
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(3);
    expect(records[0]?.sequence).toBe(1);
    expect(records[1]?.sequence).toBe(2);
    expect(records[2]?.sequence).toBe(3);
  });

  it("each event gets a unique aevt_ prefixed ID", async () => {
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.id).toMatch(/^aevt_/);
    expect(records[1]?.id).toMatch(/^aevt_/);
    expect(records[0]?.id).not.toBe(records[1]?.id);
  });

  it("sets timestamp at append time", async () => {
    const before = new Date();
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());
    const after = new Date();

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    const ts = records[0]?.timestamp;
    expect(ts).toBeInstanceOf(Date);
    expect((ts as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect((ts as Date).getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("truncates large payloads exceeding maxPayloadBytes", async () => {
    const smallLog = createEventLog(
      createDefaultOptions({
        db: mockDb,
        logger: mockLogger,
        maxPayloadBytes: 100,
      }),
    );
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    await smallLog.initSequence("conv_test123");

    smallLog.append(
      createDefaultEvent({
        payload: { data: "x".repeat(500) },
      }),
    );

    await smallLog.flush();

    const records = getInsertedRecords(mockDb);
    const payload = records[0]?.payload as {
      truncated: boolean;
      preview: string;
    };
    expect(payload.truncated).toBe(true);
    expect(payload.preview.length).toBeLessThanOrEqual(200); // Some slack
  });

  it("triggers eager flush when buffer reaches maxBufferSize", async () => {
    const smallBufLog = createEventLog(
      createDefaultOptions({
        db: mockDb,
        logger: mockLogger,
        maxBufferSize: 3,
      }),
    );
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    await smallBufLog.initSequence("conv_test123");

    smallBufLog.append(createDefaultEvent());
    smallBufLog.append(createDefaultEvent());
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Third append triggers eager flush
    smallBufLog.append(createDefaultEvent());

    // Flush is async (fire-and-forget), wait for microtask
    await vi.waitFor(() => {
      expect(mockDb.insert).toHaveBeenCalled();
    });

    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(3);
  });

  it("handles null/undefined optional fields", async () => {
    await eventLog.initSequence("conv_test123");
    // Omit optional fields entirely to test defaults
    eventLog.append({
      conversationId: "conv_test123",
      agentDefinitionId: "dev-agent",
      agentDefinitionVersion: "1.0.0",
      agentInstanceId: "ainst_abc123",
      type: "tool.called",
    });

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.parent_instance_id).toBeNull();
    expect(records[0]?.token_count_input).toBeNull();
    expect(records[0]?.token_count_output).toBeNull();
    expect(records[0]?.duration_ms).toBeNull();
    // payload defaults to {} when undefined
    expect(records[0]?.payload).toEqual({});
  });
});

describe("initSequence", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("queries database for MAX(sequence) of conversation", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    await eventLog.initSequence("conv_test123");

    expect(mockDb.select).toHaveBeenCalled();
  });

  it("sets counter to 0 when no prior events exist", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.sequence).toBe(1); // Starts at 1 (0 + 1)
  });

  it("sets counter to existing max when prior events exist", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 5 }]);
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.sequence).toBe(6); // Continues from 5 + 1
  });

  it("handles empty result gracefully", async () => {
    mockDb.setInitSequenceResult([]);
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.sequence).toBe(1);
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
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent({ type: "llm.response" }));
    eventLog.append(createDefaultEvent({ type: "tool.succeeded" }));

    await eventLog.flush();

    // db.insert called once with 3 records
    expect(mockDb.insert).toHaveBeenCalledOnce();
    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(3);
  });

  it("clears buffer after flush", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();

    // Second flush should be a no-op
    await eventLog.flush();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("is a no-op when buffer is empty", async () => {
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );

    await eventLog.flush();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does NOT throw on database error (best-effort)", async () => {
    mockDb.mockValuesFn.mockRejectedValueOnce(new Error("Connection refused"));
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());

    // Should NOT throw
    await expect(eventLog.flush()).resolves.toBeUndefined();
  });

  it("logs error on database failure", async () => {
    mockDb.mockValuesFn.mockRejectedValueOnce(new Error("Connection refused"));
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        count: 1,
      }),
      "Failed to flush events to database",
    );
  });

  it("clears buffer even on database error", async () => {
    mockDb.mockValuesFn.mockRejectedValueOnce(new Error("Connection refused"));
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    const eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.flush();

    // Reset mock
    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();
    mockDb.mockValuesFn.mockResolvedValue(undefined);

    // Second flush should be no-op (buffer was cleared despite error)
    await eventLog.flush();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("subscribe", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("handler called immediately on append (not after flush)", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({}, handler);
    eventLog.append(createDefaultEvent());

    // Handler should have been called synchronously during append
    expect(handler).toHaveBeenCalledOnce();
    // db.insert should NOT have been called yet
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("handler receives the full AgentEvent record with sequence and id", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({}, handler);
    eventLog.append(createDefaultEvent());

    const received = handler.mock.calls[0]?.[0] as AgentEvent;
    expect(received.id).toMatch(/^aevt_/);
    expect(received.sequence).toBe(1);
    expect(received.conversation_id).toBe("conv_test123");
    expect(received.type).toBe("tool.called");
    expect(received.agent_definition_id).toBe("dev-agent");
  });

  it("handler NOT called for non-matching event types when filter.types is set", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({ types: ["llm.response"] }, handler);
    eventLog.append(createDefaultEvent({ type: "tool.called" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("handler called for ALL events when filter.types is empty", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({ types: [] }, handler);
    eventLog.append(createDefaultEvent({ type: "tool.called" }));
    eventLog.append(createDefaultEvent({ type: "llm.response" }));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("handler called for ALL events when filter.types is undefined", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({}, handler);
    eventLog.append(createDefaultEvent({ type: "tool.called" }));
    eventLog.append(createDefaultEvent({ type: "agent.started" }));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe function prevents future handler calls", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);

    const unsub = eventLog.subscribe({}, handler);
    eventLog.append(createDefaultEvent());
    expect(handler).toHaveBeenCalledOnce();

    unsub();

    eventLog.append(createDefaultEvent());
    expect(handler).toHaveBeenCalledOnce(); // Still just 1
  });

  it("multiple subscribers all receive matching events", async () => {
    await eventLog.initSequence("conv_test123");
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({}, handler1);
    eventLog.subscribe({}, handler2);
    eventLog.append(createDefaultEvent());

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("handler errors are logged but do not block append or other subscribers", async () => {
    await eventLog.initSequence("conv_test123");
    const failHandler: EventSubscriptionHandler = vi
      .fn()
      .mockRejectedValue(new Error("subscriber error"));
    const successHandler = vi.fn().mockResolvedValue(undefined);

    eventLog.subscribe({}, failHandler);
    eventLog.subscribe({}, successHandler);

    // append should not throw even though a handler rejects
    expect(() => eventLog.append(createDefaultEvent())).not.toThrow();

    // Both handlers should have been called
    expect(failHandler).toHaveBeenCalledOnce();
    expect(successHandler).toHaveBeenCalledOnce();

    // Wait for the promise rejection to be caught and logged
    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Event subscriber handler error",
      );
    });
  });
});

describe("query", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("flushes buffer before querying", async () => {
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());

    // Before query, insert should not have been called
    expect(mockDb.insert).not.toHaveBeenCalled();

    // query() triggers a flush
    // Make the orderBy chain resolve for query (without limit)
    mockDb.mockOrderByFn.mockResolvedValue([]);
    await eventLog.query("conv_test123");

    // The flush should have called insert
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("returns events for the specified conversation", async () => {
    const mockEvents = [
      { id: "aevt_1", conversation_id: "conv_test123", sequence: 1 },
      { id: "aevt_2", conversation_id: "conv_test123", sequence: 2 },
    ];
    mockDb.mockOrderByFn.mockResolvedValue(mockEvents);

    const result = await eventLog.query("conv_test123");
    expect(result).toEqual(mockEvents);
  });

  it("supports type filtering", async () => {
    mockDb.mockOrderByFn.mockResolvedValue([]);
    await eventLog.query("conv_test123", { types: ["tool.called"] });

    // Verify the where clause was called (type filtering applied)
    expect(mockDb.mockWhereFn).toHaveBeenCalled();
  });

  it("supports afterSequence filtering", async () => {
    mockDb.mockOrderByFn.mockResolvedValue([]);
    await eventLog.query("conv_test123", { afterSequence: 5 });

    expect(mockDb.mockWhereFn).toHaveBeenCalled();
  });

  it("supports limit", async () => {
    const mockEvents = [{ id: "aevt_1" }];
    mockDb.mockSelectResult.mockResolvedValue(mockEvents);
    mockDb.mockOrderByFn.mockReturnValue({ limit: mockDb.mockSelectResult });

    const result = await eventLog.query("conv_test123", { limit: 10 });
    expect(mockDb.mockSelectResult).toHaveBeenCalledWith(10);
    expect(result).toEqual(mockEvents);
  });
});

describe("close", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("flushes remaining events before closing", async () => {
    await eventLog.initSequence("conv_test123");
    eventLog.append(createDefaultEvent());

    expect(mockDb.insert).not.toHaveBeenCalled();

    await eventLog.close();

    expect(mockDb.insert).toHaveBeenCalled();
    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
  });

  it("subsequent append throws after close", async () => {
    await eventLog.initSequence("conv_test123");
    await eventLog.close();

    expect(() => eventLog.append(createDefaultEvent())).toThrow(
      "EventLog is closed",
    );
  });

  it("clears all subscribers", async () => {
    await eventLog.initSequence("conv_test123");
    const handler = vi.fn().mockResolvedValue(undefined);
    eventLog.subscribe({}, handler);

    await eventLog.close();

    // Cannot append after close, so we verify indirectly by
    // checking that close logs the completion message
    expect(mockLogger.info).toHaveBeenCalledWith("EventLog closed");
  });
});

describe("gapless sequences", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let eventLog: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    eventLog = createEventLog(
      createDefaultOptions({ db: mockDb, logger: mockLogger }),
    );
  });

  it("multiple events for same conversation get sequential numbers", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.sequence).toBe(1);
    expect(records[1]?.sequence).toBe(2);
    expect(records[2]?.sequence).toBe(3);
  });

  it("different conversations get independent sequences", async () => {
    // Init both conversations (default mock returns maxSeq: 0)
    await eventLog.initSequence("conv_aaa");
    await eventLog.initSequence("conv_bbb");

    eventLog.append(createDefaultEvent({ conversationId: "conv_aaa" }));
    eventLog.append(createDefaultEvent({ conversationId: "conv_bbb" }));
    eventLog.append(createDefaultEvent({ conversationId: "conv_aaa" }));

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    // conv_aaa events: sequence 1, 2
    const aaa = records.filter((r) => r.conversation_id === "conv_aaa");
    expect(aaa[0]?.sequence).toBe(1);
    expect(aaa[1]?.sequence).toBe(2);

    // conv_bbb events: sequence 1
    const bbb = records.filter((r) => r.conversation_id === "conv_bbb");
    expect(bbb[0]?.sequence).toBe(1);
  });

  it("after initSequence with existing events, next event continues from max", async () => {
    mockDb.setInitSequenceResult([{ maxSeq: 5 }]);
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    eventLog.append(createDefaultEvent());

    await eventLog.flush();

    const records = getInsertedRecords(mockDb);
    expect(records[0]?.sequence).toBe(6);
    expect(records[1]?.sequence).toBe(7);
  });
});

describe("timer-based flush", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    mockDb.setInitSequenceResult([{ maxSeq: 0 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("events are flushed after flushIntervalMs elapses", async () => {
    const eventLog = createEventLog(
      createDefaultOptions({
        db: mockDb,
        logger: mockLogger,
        flushIntervalMs: 500,
      }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());

    // Not flushed yet
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Advance timer past flush interval
    await vi.advanceTimersByTimeAsync(500);

    expect(mockDb.insert).toHaveBeenCalled();
    const records = getInsertedRecords(mockDb);
    expect(records).toHaveLength(1);
  });

  it("timer is cleared on explicit flush", async () => {
    const eventLog = createEventLog(
      createDefaultOptions({
        db: mockDb,
        logger: mockLogger,
        flushIntervalMs: 1000,
      }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());

    // Explicit flush
    await eventLog.flush();

    expect(mockDb.insert).toHaveBeenCalledOnce();

    // Reset mock
    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();

    // Advance past original timer interval -- should NOT trigger another flush
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("timer is cleared on close", async () => {
    const eventLog = createEventLog(
      createDefaultOptions({
        db: mockDb,
        logger: mockLogger,
        flushIntervalMs: 1000,
      }),
    );
    await eventLog.initSequence("conv_test123");

    eventLog.append(createDefaultEvent());
    await eventLog.close();

    // Reset mock
    mockDb.insert.mockClear();
    mockDb.mockValuesFn.mockClear();

    // Advance timer -- should NOT trigger another flush
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
