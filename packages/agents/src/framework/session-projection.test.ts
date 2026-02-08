/**
 * SessionProjection Unit Tests
 *
 * Tests for createSessionProjection factory: lifecycle event handling,
 * artifact extraction via atomic JSONB merge, error resilience, and cleanup.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../shared/db/schema.js";
import { agentSessions } from "../shared/db/schema.js";
import {
  createSessionProjection,
  getNestedValue,
} from "./session-projection.js";
import type {
  ArtifactExtractionConfig,
  EventLog,
  EventSubscriptionFilter,
  EventSubscriptionHandler,
  SessionProjectionOptions,
} from "./types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: "aevt_test123",
    conversation_id: "conv_test456",
    agent_definition_id: "dev-agent",
    agent_definition_version: "1.0.0",
    agent_instance_id: "ainst_abc",
    parent_instance_id: null,
    sequence: 1,
    type: "agent.started",
    payload: {},
    timestamp: new Date("2026-02-01T00:00:00Z"),
    token_count_input: null,
    token_count_output: null,
    duration_ms: null,
    ...overrides,
  };
}

function createMockEventLog() {
  let capturedHandler: EventSubscriptionHandler | null = null;
  const unsubscribeFn = vi.fn();

  return {
    subscribe: vi.fn(
      (_filter: EventSubscriptionFilter, handler: EventSubscriptionHandler) => {
        capturedHandler = handler;
        return unsubscribeFn;
      },
    ),
    simulateEvent: async (event: AgentEvent) => {
      if (capturedHandler) {
        await capturedHandler(event);
      }
    },
    unsubscribeFn,
    append: vi.fn(),
    query: vi.fn(),
    flush: vi.fn(),
    close: vi.fn(),
    initSequence: vi.fn(),
  };
}

function createMockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

/**
 * Create a mock DB with chainable Drizzle methods.
 *
 * Supports:
 * - insert().values().onConflictDoUpdate()
 * - update().set().where()
 * - select().from().where().limit()
 */
function createMockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insertFn = vi.fn().mockReturnValue({ values });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const selectLimit = vi.fn().mockResolvedValue([]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    db: {
      insert: insertFn,
      update: updateFn,
      select: selectFn,
    },
    mocks: {
      insert: insertFn,
      values,
      onConflictDoUpdate,
      update: updateFn,
      set: updateSet,
      where: updateWhere,
      select: selectFn,
      selectFrom,
      selectWhere,
      selectLimit,
    },
  };
}

const testArtifactConfig: ArtifactExtractionConfig = new Map([
  [
    "create_pull_request",
    { artifactKey: "pr_url", payloadPath: "result.prUrl" },
  ],
  [
    "create_branch",
    { artifactKey: "branch_name", payloadPath: "result.branchName" },
  ],
]);

function createTestOptions(
  overrides?: Partial<SessionProjectionOptions>,
): SessionProjectionOptions {
  const { db } = createMockDb();
  return {
    db: db as unknown as SessionProjectionOptions["db"],
    logger: createMockLogger() as unknown as SessionProjectionOptions["logger"],
    eventLog: createMockEventLog() as unknown as EventLog,
    artifactConfig: testArtifactConfig,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createSessionProjection", () => {
  it("throws if db is missing", () => {
    const options = createTestOptions();
    (options as unknown as Record<string, unknown>).db = null;

    expect(() => createSessionProjection(options)).toThrow(
      "db is required for SessionProjection",
    );
  });

  it("throws if logger is missing", () => {
    const options = createTestOptions();
    (options as unknown as Record<string, unknown>).logger = null;

    expect(() => createSessionProjection(options)).toThrow(
      "logger is required for SessionProjection",
    );
  });

  it("throws if eventLog is missing", () => {
    const options = createTestOptions();
    (options as unknown as Record<string, unknown>).eventLog = null;

    expect(() => createSessionProjection(options)).toThrow(
      "eventLog is required for SessionProjection",
    );
  });

  it("throws if artifactConfig is missing", () => {
    const options = createTestOptions();
    (options as unknown as Record<string, unknown>).artifactConfig = null;

    expect(() => createSessionProjection(options)).toThrow(
      "artifactConfig is required for SessionProjection",
    );
  });

  it("subscribes to EventLog with correct event type filter", () => {
    const mockEventLog = createMockEventLog();
    createTestOptions();
    const { db } = createMockDb();

    createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    expect(mockEventLog.subscribe).toHaveBeenCalledOnce();
    const filter = mockEventLog.subscribe.mock.calls[0]?.[0] as
      | EventSubscriptionFilter
      | undefined;
    expect(filter?.types).toEqual([
      "agent.started",
      "agent.completed",
      "agent.paused",
      "agent.resumed",
      "agent.reopened",
      "tool.succeeded",
    ]);
  });

  it("returns object with getSession and close methods", () => {
    const options = createTestOptions();
    const projection = createSessionProjection(options);

    expect(typeof projection.getSession).toBe("function");
    expect(typeof projection.close).toBe("function");
  });
});

describe("agent.started", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventLog = createMockEventLog();
    createSessionProjection({
      db: mockDb.db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });
  });

  it("inserts new agent_sessions row with status running", async () => {
    const event = createMockEvent({ type: "agent.started" });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.insert).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv_test456",
        agent_definition_id: "dev-agent",
        status: "running",
        last_event_type: "agent.started",
        artifacts: {},
      }),
    );
  });

  it("sets started_at from event timestamp", async () => {
    const timestamp = new Date("2026-02-01T12:00:00Z");
    const event = createMockEvent({ type: "agent.started", timestamp });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        started_at: timestamp,
        last_event_at: timestamp,
      }),
    );
  });

  it("uses onConflictDoUpdate for idempotency", async () => {
    const event = createMockEvent({ type: "agent.started" });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: agentSessions.conversation_id,
        set: expect.objectContaining({
          status: "running",
          last_event_type: "agent.started",
        }),
      }),
    );
  });
});

describe("agent.completed", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventLog = createMockEventLog();
    createSessionProjection({
      db: mockDb.db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });
  });

  it("updates status to completed when payload has no error", async () => {
    const event = createMockEvent({
      type: "agent.completed",
      payload: { result: "success" },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("updates status to failed when payload has error field", async () => {
    const event = createMockEvent({
      type: "agent.completed",
      payload: { error: "Something went wrong" },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("updates last_event_type and last_event_at", async () => {
    const timestamp = new Date("2026-02-01T15:00:00Z");
    const event = createMockEvent({
      type: "agent.completed",
      payload: {},
      timestamp,
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        last_event_type: "agent.completed",
        last_event_at: timestamp,
      }),
    );
  });
});

describe("agent.paused", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventLog = createMockEventLog();
    createSessionProjection({
      db: mockDb.db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });
  });

  it("updates status to waiting", async () => {
    const event = createMockEvent({ type: "agent.paused" });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "waiting" }),
    );
  });

  it("updates last_event_type and last_event_at", async () => {
    const timestamp = new Date("2026-02-01T16:00:00Z");
    const event = createMockEvent({ type: "agent.paused", timestamp });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        last_event_type: "agent.paused",
        last_event_at: timestamp,
      }),
    );
  });
});

describe("agent.resumed", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventLog = createMockEventLog();
    createSessionProjection({
      db: mockDb.db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });
  });

  it("updates status to running", async () => {
    const event = createMockEvent({ type: "agent.resumed" });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running" }),
    );
  });

  it("updates last_event_type and last_event_at", async () => {
    const timestamp = new Date("2026-02-01T17:00:00Z");
    const event = createMockEvent({ type: "agent.resumed", timestamp });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        last_event_type: "agent.resumed",
        last_event_at: timestamp,
      }),
    );
  });
});

describe("tool.succeeded - artifact extraction", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventLog = createMockEventLog();
    createSessionProjection({
      db: mockDb.db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });
  });

  it("extracts artifact when tool name matches config with atomic update", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: {
        toolName: "create_pull_request",
        result: { prUrl: "https://github.com/org/repo/pull/42" },
      },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.set).toHaveBeenCalledOnce();

    // Verify the artifacts field uses a SQL expression (atomic JSONB merge), not a plain object
    const setArg = mockDb.mocks.set.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(setArg?.artifacts).toBeDefined();
    // SQL template objects have a queryChunks or similar property -- they are NOT plain objects/strings
    expect(typeof setArg?.artifacts).not.toBe("string");
    expect(setArg?.artifacts).not.toBeInstanceOf(Array);
  });

  it("uses payloadPath to resolve nested values", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: {
        toolName: "create_branch",
        result: { branchName: "feature/auth-flow" },
      },
    });
    await mockEventLog.simulateEvent(event);

    // Verify that update was called (artifact extraction happened)
    expect(mockDb.mocks.update).toHaveBeenCalledWith(agentSessions);
    expect(mockDb.mocks.set).toHaveBeenCalledOnce();
  });

  it("skips extraction when tool name not in config", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: {
        toolName: "get_issue",
        result: { title: "Some issue" },
      },
    });
    await mockEventLog.simulateEvent(event);

    // No DB call at all
    expect(mockDb.mocks.update).not.toHaveBeenCalled();
    expect(mockDb.mocks.insert).not.toHaveBeenCalled();
  });

  it("skips extraction when payload value is null at path", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: {
        toolName: "create_pull_request",
        result: { prUrl: null },
      },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).not.toHaveBeenCalled();
  });

  it("skips extraction when payload value is undefined at path", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: {
        toolName: "create_pull_request",
        result: {},
      },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).not.toHaveBeenCalled();
  });

  it("skips extraction when event payload has no toolName field", async () => {
    const event = createMockEvent({
      type: "tool.succeeded",
      payload: { result: { prUrl: "https://example.com" } },
    });
    await mockEventLog.simulateEvent(event);

    expect(mockDb.mocks.update).not.toHaveBeenCalled();
    expect(mockDb.mocks.insert).not.toHaveBeenCalled();
  });
});

describe("error handling", () => {
  it("DB error during upsert is logged but does not throw", async () => {
    const mockEventLog = createMockEventLog();
    const mockLogger = createMockLogger();
    const { db, mocks } = createMockDb();

    // Make the DB insert chain throw
    mocks.onConflictDoUpdate.mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger: mockLogger as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    const event = createMockEvent({ type: "agent.started" });

    // Should NOT reject -- error is caught and logged
    await expect(mockEventLog.simulateEvent(event)).resolves.toBeUndefined();

    // Error should be logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        eventType: "agent.started",
        conversationId: "conv_test456",
      }),
      "SessionProjection failed to handle event",
    );
  });
});

describe("getSession", () => {
  it("returns session when it exists", async () => {
    const mockEventLog = createMockEventLog();
    const { db, mocks } = createMockDb();

    const mockSession = {
      conversation_id: "conv_test456",
      agent_definition_id: "dev-agent",
      status: "running",
      last_event_type: "agent.started",
      last_event_at: new Date(),
      artifacts: {},
      started_at: new Date(),
      updated_at: new Date(),
    };
    mocks.selectLimit.mockResolvedValueOnce([mockSession]);

    const projection = createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    const result = await projection.getSession("conv_test456");
    expect(result).toEqual(mockSession);
    expect(mocks.select).toHaveBeenCalled();
  });

  it("returns null when no session exists", async () => {
    const mockEventLog = createMockEventLog();
    const { db, mocks } = createMockDb();

    mocks.selectLimit.mockResolvedValueOnce([]);

    const projection = createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    const result = await projection.getSession("conv_nonexistent");
    expect(result).toBeNull();
  });
});

describe("close", () => {
  it("calls unsubscribe function from EventLog", () => {
    const mockEventLog = createMockEventLog();
    const { db } = createMockDb();

    const projection = createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger:
        createMockLogger() as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    projection.close();
    expect(mockEventLog.unsubscribeFn).toHaveBeenCalledOnce();
  });

  it("logs closure message", () => {
    const mockEventLog = createMockEventLog();
    const mockLogger = createMockLogger();
    const { db } = createMockDb();

    const projection = createSessionProjection({
      db: db as unknown as SessionProjectionOptions["db"],
      logger: mockLogger as unknown as SessionProjectionOptions["logger"],
      eventLog: mockEventLog as unknown as EventLog,
      artifactConfig: testArtifactConfig,
    });

    projection.close();
    expect(mockLogger.info).toHaveBeenCalledWith("SessionProjection closed");
  });
});

describe("getNestedValue", () => {
  it("resolves simple path", () => {
    expect(getNestedValue({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("resolves nested path", () => {
    expect(
      getNestedValue(
        { result: { prUrl: "https://example.com" } },
        "result.prUrl",
      ),
    ).toBe("https://example.com");
  });

  it("returns undefined for missing path", () => {
    expect(getNestedValue({ result: {} }, "result.prUrl")).toBeUndefined();
  });

  it("returns undefined for null intermediate", () => {
    expect(
      getNestedValue(
        { result: null } as Record<string, unknown>,
        "result.prUrl",
      ),
    ).toBeUndefined();
  });
});
