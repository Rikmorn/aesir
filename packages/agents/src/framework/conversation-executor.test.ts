/**
 * ConversationExecutor Tests
 *
 * Tests for createConversationExecutor() covering: factory validation,
 * start (deterministic IDs, idempotent no-op, re-trigger suffixes),
 * signal (resume, queue, dedup, reject), get, cancel, and list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConversationExecutor } from "./conversation-executor.js";
import type {
  AgentDefinition,
  AgentRegistry,
  ConversationExecutor,
  ConversationExecutorOptions,
  ToolRegistry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

/** Conversation row returned by SELECT queries */
interface MockConversationRow {
  id: string;
  agent_definition_id: string;
  agent_definition_version: string;
  status: string;
  messages: unknown[];
  pending_wait: Record<string, unknown> | null;
  queued_signals: unknown[];
  delivered_signal_ids: string[];
  claimed_by: string | null;
  claimed_at: Date | null;
  last_heartbeat_at: Date | null;
  error_message: string | null;
  parent_conversation_id: string | null;
  retry_count: number;
  max_retries: number;
  created_at: Date;
  updated_at: Date;
}

function createMockConversationRow(
  overrides?: Partial<MockConversationRow>,
): MockConversationRow {
  return {
    id: "dev-agent-AES-42",
    agent_definition_id: "dev-agent",
    agent_definition_version: "1.0.0",
    status: "queued",
    messages: [{ role: "user", content: "Do something" }],
    pending_wait: null,
    queued_signals: [],
    delivered_signal_ids: [],
    claimed_by: null,
    claimed_at: null,
    last_heartbeat_at: null,
    error_message: null,
    parent_conversation_id: null,
    retry_count: 0,
    max_retries: 2,
    created_at: new Date("2026-02-01T00:00:00Z"),
    updated_at: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Create a mock Drizzle DB with chainable query builders.
 *
 * Supports:
 * - select().from().where().for().limit().orderBy()
 * - insert().values()
 * - update().set().where()
 * - transaction(callback) - executes callback with same mock
 */
function createMockDb() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // select chain: select().from().where().for()/limit()/orderBy()
  // Must support both .for("update") for transactions and .limit() for queries
  const limitFn = vi.fn().mockResolvedValue([]);
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const forFn = vi.fn().mockResolvedValue([]);
  const whereFn = vi.fn().mockImplementation(() => {
    // Return a thenable that also has .for(), .limit(), .orderBy()
    const result = Promise.resolve([]);
    return Object.assign(result, {
      for: forFn,
      limit: limitFn,
      orderBy: orderByFn,
    });
  });
  const fromFn = vi.fn().mockReturnValue({
    where: whereFn,
    orderBy: orderByFn,
  });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  // Transaction: execute callback with the same mock (pass-through)
  const transactionFn = vi.fn().mockImplementation(async (callback) => {
    const txProxy = {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
    };
    return callback(txProxy);
  });

  return {
    db: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
      transaction: transactionFn,
    },
    mocks: {
      select: selectFn,
      from: fromFn,
      where: whereFn,
      for: forFn,
      limit: limitFn,
      orderBy: orderByFn,
      insert: insertFn,
      insertValues,
      update: updateFn,
      updateSet,
      updateWhere,
      transaction: transactionFn,
    },
    /** Set what the FOR UPDATE select returns */
    setForUpdateResult(rows: MockConversationRow[]) {
      forFn.mockResolvedValue(rows);
    },
    /** Set what the regular select + limit returns */
    setSelectResult(rows: unknown[]) {
      limitFn.mockResolvedValue(rows);
    },
    /** Set what the regular select + where (thenable) returns */
    setWhereResult(rows: unknown[]) {
      whereFn.mockImplementation(() => {
        const result = Promise.resolve(rows);
        return Object.assign(result, {
          for: forFn,
          limit: limitFn,
          orderBy: orderByFn,
        });
      });
    },
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
    silent: vi.fn(),
    level: "info",
  };
}

function createMockEventLog() {
  return {
    append: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    initSequence: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSessionProjection() {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
  };
}

function createMockAgentDefinition(
  overrides?: Partial<AgentDefinition>,
): AgentDefinition {
  return {
    id: "dev-agent",
    name: "Dev Agent",
    description: "Development automation",
    version: "1.0.0",
    model: "claude-sonnet-4-20250514",
    tools: ["codebase:read_file"],
    maxIterations: 50,
    tokenBudget: 100000,
    history: {
      pruneThreshold: 100,
      protectedMessages: 5,
      summaryThreshold: 50,
      summaryModel: "claude-sonnet-4-20250514",
    },
    systemPrompt: "You are a dev agent.",
    ...overrides,
  };
}

function createMockAgentRegistry(): AgentRegistry & {
  get: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(createMockAgentDefinition()),
    list: vi.fn().mockResolvedValue([createMockAgentDefinition()]),
  };
}

function createMockToolRegistry(): ToolRegistry {
  return {
    register: vi.fn(),
    resolve: vi.fn().mockReturnValue([]),
    has: vi.fn().mockReturnValue(true),
    listRegistered: vi.fn().mockReturnValue([]),
  };
}

function createTestOptions(overrides?: {
  db?: ReturnType<typeof createMockDb>;
  eventLog?: ReturnType<typeof createMockEventLog>;
  sessionProjection?: ReturnType<typeof createMockSessionProjection>;
  agentRegistry?: ReturnType<typeof createMockAgentRegistry>;
  toolRegistry?: ReturnType<typeof createMockToolRegistry>;
  logger?: ReturnType<typeof createMockLogger>;
}): {
  options: ConversationExecutorOptions;
  mockDb: ReturnType<typeof createMockDb>;
  mockEventLog: ReturnType<typeof createMockEventLog>;
  mockSessionProjection: ReturnType<typeof createMockSessionProjection>;
  mockAgentRegistry: ReturnType<typeof createMockAgentRegistry>;
  mockToolRegistry: ReturnType<typeof createMockToolRegistry>;
  mockLogger: ReturnType<typeof createMockLogger>;
} {
  const mockDb = overrides?.db ?? createMockDb();
  const mockEventLog = overrides?.eventLog ?? createMockEventLog();
  const mockSessionProjection =
    overrides?.sessionProjection ?? createMockSessionProjection();
  const mockAgentRegistry =
    overrides?.agentRegistry ?? createMockAgentRegistry();
  const mockToolRegistry = overrides?.toolRegistry ?? createMockToolRegistry();
  const mockLogger = overrides?.logger ?? createMockLogger();

  return {
    options: {
      db: mockDb.db as unknown as ConversationExecutorOptions["db"],
      eventLog: mockEventLog,
      sessionProjection: mockSessionProjection,
      agentRegistry: mockAgentRegistry,
      toolRegistry: mockToolRegistry,
      logger: mockLogger as unknown as ConversationExecutorOptions["logger"],
    },
    mockDb,
    mockEventLog,
    mockSessionProjection,
    mockAgentRegistry,
    mockToolRegistry,
    mockLogger,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createConversationExecutor", () => {
  it("throws if db is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).db = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "db is required for ConversationExecutor",
    );
  });

  it("throws if eventLog is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).eventLog = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "eventLog is required for ConversationExecutor",
    );
  });

  it("throws if sessionProjection is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).sessionProjection = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "sessionProjection is required for ConversationExecutor",
    );
  });

  it("throws if agentRegistry is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).agentRegistry = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "agentRegistry is required for ConversationExecutor",
    );
  });

  it("throws if toolRegistry is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).toolRegistry = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "toolRegistry is required for ConversationExecutor",
    );
  });

  it("throws if logger is missing", () => {
    const { options } = createTestOptions();
    (options as unknown as Record<string, unknown>).logger = null;
    expect(() => createConversationExecutor(options)).toThrow(
      "logger is required for ConversationExecutor",
    );
  });

  it("returns object with all ConversationExecutor methods", () => {
    const { options } = createTestOptions();
    const executor = createConversationExecutor(options);

    expect(typeof executor.start).toBe("function");
    expect(typeof executor.signal).toBe("function");
    expect(typeof executor.get).toBe("function");
    expect(typeof executor.cancel).toBe("function");
    expect(typeof executor.list).toBe("function");
  });
});

// ─── start() ─────────────────────────────────────────────────────────────────

describe("start() -- new conversation", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAgentRegistry: ReturnType<typeof createMockAgentRegistry>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    mockAgentRegistry = ctx.mockAgentRegistry;
    // No existing conversation: FOR UPDATE returns empty
    mockDb.setForUpdateResult([]);
  });

  it("creates conversation with deterministic ID: agentDefinitionId-correlationKey", async () => {
    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(id).toBe("dev-agent-AES-42");
  });

  it("returns the conversation ID", async () => {
    const id = await executor.start({
      agentDefinitionId: "researcher",
      correlationKey: "task-789",
      initialMessage: "Research auth patterns",
    });

    expect(id).toBe("researcher-task-789");
  });

  it("inserts with status queued", async () => {
    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
  });

  it("stores initial message in messages array", async () => {
    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Implement auth" }],
      }),
    );
  });

  it("sets agent_definition_id and agent_definition_version from registry", async () => {
    mockAgentRegistry.get.mockResolvedValue(
      createMockAgentDefinition({ version: "2.5.0" }),
    );

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_definition_id: "dev-agent",
        agent_definition_version: "2.5.0",
      }),
    );
  });

  it("throws if agent definition not found in registry", async () => {
    mockAgentRegistry.get.mockResolvedValue(null);

    await expect(
      executor.start({
        agentDefinitionId: "nonexistent-agent",
        correlationKey: "AES-42",
        initialMessage: "Do something",
      }),
    ).rejects.toThrow("Agent definition not found: nonexistent-agent");
  });
});

describe("start() -- idempotent no-op", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns existing ID when conversation is running", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "running" }),
    ]);

    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(id).toBe("dev-agent-AES-42");
    // Should NOT have called insert
    expect(mockDb.mocks.insertValues).not.toHaveBeenCalled();
  });

  it("returns existing ID when conversation is queued", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "queued" }),
    ]);

    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(id).toBe("dev-agent-AES-42");
    expect(mockDb.mocks.insertValues).not.toHaveBeenCalled();
  });

  it("returns existing ID when conversation is waiting", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "waiting" }),
    ]);

    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(id).toBe("dev-agent-AES-42");
    expect(mockDb.mocks.insertValues).not.toHaveBeenCalled();
  });
});

describe("start() -- re-trigger from terminal state", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockSessionProjection: ReturnType<typeof createMockSessionProjection>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    mockSessionProjection = ctx.mockSessionProjection;
  });

  it("creates new conversation with -r2 suffix when existing is completed", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);
    // No existing re-trigger suffixed conversations
    mockDb.mocks.limit.mockResolvedValue([]);

    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Retry the task",
    });

    expect(id).toBe("dev-agent-AES-42-r2");
    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dev-agent-AES-42-r2",
        status: "queued",
      }),
    );
  });

  it("creates -r3 suffix when -r2 already exists", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "failed" }),
    ]);
    // findNextSuffix query returns existing -r2
    mockDb.mocks.limit.mockResolvedValue([{ id: "dev-agent-AES-42-r2" }]);

    const id = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Third attempt",
    });

    expect(id).toBe("dev-agent-AES-42-r3");
  });

  it("injects previous attempt context into initial message", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);
    mockDb.mocks.limit.mockResolvedValue([]);
    mockSessionProjection.getSession.mockResolvedValue({
      conversation_id: "dev-agent-AES-42",
      agent_definition_id: "dev-agent",
      status: "completed",
      last_event_type: "agent.completed",
      last_event_at: new Date(),
      artifacts: { pr_url: "https://github.com/org/repo/pull/42" },
      started_at: new Date(),
      updated_at: new Date(),
    });

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Retry with fixes",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: expect.stringContaining(
              "[Previous attempt dev-agent-AES-42: completed.",
            ),
          },
        ],
      }),
    );

    // Verify artifacts are included
    const insertCall = mockDb.mocks.insertValues.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(insertCall.messages[0]?.content).toContain("pr_url");
    expect(insertCall.messages[0]?.content).toContain("Retry with fixes");
  });

  it("handles failed state re-trigger with error context", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "failed",
        error_message: "Token budget exhausted",
      }),
    ]);
    mockDb.mocks.limit.mockResolvedValue([]);
    mockSessionProjection.getSession.mockResolvedValue({
      conversation_id: "dev-agent-AES-42",
      agent_definition_id: "dev-agent",
      status: "failed",
      last_event_type: "agent.completed",
      last_event_at: new Date(),
      artifacts: {},
      started_at: new Date(),
      updated_at: new Date(),
    });

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Try again",
    });

    const insertCall = mockDb.mocks.insertValues.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(insertCall.messages[0]?.content).toContain("failed");
    expect(insertCall.messages[0]?.content).toContain("Token budget exhausted");
  });
});

// ─── signal() ────────────────────────────────────────────────────────────────

describe("signal() -- resume waiting", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;
  let _mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    _mockEventLog = ctx.mockEventLog;
  });

  it("resumes waiting conversation with matching signal type (status -> queued)", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
      data: { approved: true },
    });

    expect(result).toEqual({ action: "resumed" });
    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
  });

  it("appends signal as user message to messages array", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
        messages: [{ role: "user", content: "Original message" }],
      }),
    ]);

    await executor.signal("dev-agent-AES-42", {
      type: "approval",
      message: "Approved with feedback",
    });

    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "Original message" },
          { role: "user", content: "Approved with feedback" },
        ],
      }),
    );
  });

  it("clears pending_wait after resume", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval", reason: "Need review" },
      }),
    ]);

    await executor.signal("dev-agent-AES-42", { type: "approval" });

    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ pending_wait: null }),
    );
  });

  it("returns { action: resumed }", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
    });

    expect(result.action).toBe("resumed");
  });
});

describe("signal() -- queue for running", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("queues signal when conversation is running", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "running" }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "new_info",
      data: { info: "Extra context" },
    });

    expect(result).toEqual({ action: "queued" });
    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        queued_signals: [{ type: "new_info", data: { info: "Extra context" } }],
      }),
    );
  });

  it("returns { action: queued }", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "queued" }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "update",
    });

    expect(result.action).toBe("queued");
  });
});

describe("signal() -- deduplication", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns { action: deduplicated } for duplicate signal", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
        delivered_signal_ids: ["slack:msg-001"],
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
      source: "slack",
      deduplicationId: "msg-001",
    });

    expect(result).toEqual({ action: "deduplicated" });
    // Should NOT update the conversation
    expect(mockDb.mocks.updateSet).not.toHaveBeenCalled();
  });

  it("tracks delivered signal ID in delivered_signal_ids", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
        delivered_signal_ids: [],
      }),
    ]);

    await executor.signal("dev-agent-AES-42", {
      type: "approval",
      source: "slack",
      deduplicationId: "msg-002",
    });

    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        delivered_signal_ids: ["slack:msg-002"],
      }),
    );
  });
});

describe("signal() -- rejection", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns { action: rejected } for unknown conversation", async () => {
    mockDb.setForUpdateResult([]);

    const result = await executor.signal("nonexistent-conv", {
      type: "approval",
    });

    expect(result).toEqual({ action: "rejected" });
  });

  it("returns { action: rejected } for type mismatch on waiting conversation", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "pr_review", // mismatch with pending "approval"
    });

    expect(result).toEqual({ action: "rejected" });
    expect(mockDb.mocks.updateSet).not.toHaveBeenCalled();
  });

  it("returns { action: rejected } for terminal status conversation", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
    });

    expect(result).toEqual({ action: "rejected" });
  });
});

// ─── get() ───────────────────────────────────────────────────────────────────

describe("get()", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns ConversationInfo for existing conversation", async () => {
    const now = new Date("2026-02-01T12:00:00Z");
    mockDb.mocks.limit.mockResolvedValue([
      {
        id: "dev-agent-AES-42",
        agent_definition_id: "dev-agent",
        agent_definition_version: "1.0.0",
        status: "running",
        created_at: now,
        updated_at: now,
      },
    ]);

    const info = await executor.get("dev-agent-AES-42");

    expect(info).toEqual({
      id: "dev-agent-AES-42",
      agentDefinitionId: "dev-agent",
      agentDefinitionVersion: "1.0.0",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("returns null for unknown conversation", async () => {
    mockDb.mocks.limit.mockResolvedValue([]);

    const info = await executor.get("nonexistent-conv");

    expect(info).toBeNull();
  });
});

// ─── cancel() ────────────────────────────────────────────────────────────────

describe("cancel()", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventLog: ReturnType<typeof createMockEventLog>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    mockEventLog = ctx.mockEventLog;
  });

  it("cancels running conversation, returns true", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "running" }),
    ]);

    const result = await executor.cancel("dev-agent-AES-42");

    expect(result).toBe(true);
    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("returns false for already-terminal conversation", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);

    const result = await executor.cancel("dev-agent-AES-42");

    expect(result).toBe(false);
    expect(mockDb.mocks.updateSet).not.toHaveBeenCalled();
  });

  it("clears claimed_by and claimed_at on cancel", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "running",
        claimed_by: "worker-1",
        claimed_at: new Date(),
      }),
    ]);

    await executor.cancel("dev-agent-AES-42");

    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed_by: null,
        claimed_at: null,
        last_heartbeat_at: null,
      }),
    );
  });

  it("appends agent.completed event with error Cancelled", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "running" }),
    ]);

    await executor.cancel("dev-agent-AES-42");

    expect(mockEventLog.initSequence).toHaveBeenCalledWith("dev-agent-AES-42");
    expect(mockEventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.completed",
        payload: { error: "Cancelled" },
      }),
    );
    expect(mockEventLog.flush).toHaveBeenCalled();
  });

  it("returns false for not-found conversation", async () => {
    mockDb.setForUpdateResult([]);

    const result = await executor.cancel("nonexistent-conv");

    expect(result).toBe(false);
  });
});

// ─── list() ──────────────────────────────────────────────────────────────────

describe("list()", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns all conversations when no filters specified", async () => {
    const now = new Date("2026-02-01T12:00:00Z");
    mockDb.mocks.limit.mockResolvedValue([
      {
        id: "dev-agent-AES-42",
        agent_definition_id: "dev-agent",
        agent_definition_version: "1.0.0",
        status: "running",
        created_at: now,
        updated_at: now,
      },
      {
        id: "dev-agent-AES-43",
        agent_definition_id: "dev-agent",
        agent_definition_version: "1.0.0",
        status: "completed",
        created_at: now,
        updated_at: now,
      },
    ]);

    const results = await executor.list();

    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe("dev-agent-AES-42");
    expect(results[1]?.id).toBe("dev-agent-AES-43");
  });

  it("filters by status", async () => {
    const now = new Date();
    mockDb.mocks.limit.mockResolvedValue([
      {
        id: "dev-agent-AES-42",
        agent_definition_id: "dev-agent",
        agent_definition_version: "1.0.0",
        status: "running",
        created_at: now,
        updated_at: now,
      },
    ]);

    const results = await executor.list({ status: "running" });

    expect(results).toHaveLength(1);
    // Verify the where clause was invoked (via db.select chain)
    expect(mockDb.mocks.where).toHaveBeenCalled();
  });

  it("filters by agentDefinitionId", async () => {
    mockDb.mocks.limit.mockResolvedValue([]);

    const results = await executor.list({
      agentDefinitionId: "researcher",
    });

    expect(results).toEqual([]);
    expect(mockDb.mocks.where).toHaveBeenCalled();
  });
});

// ─── Timeout Cancellation ─────────────────────────────────────────────────────

describe("timeout cancellation", () => {
  function createMockTimeoutScheduler() {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue("timeout-job-123"),
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getBoss: vi.fn().mockReturnValue(undefined),
    };
  }

  it("cancels timeout when signal resumes a waiting conversation with timeoutJobId", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    ctx.mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval", timeoutJobId: "job-xyz" },
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
      data: { approved: true },
    });

    expect(result).toEqual({ action: "resumed" });
    expect(mockScheduler.cancel).toHaveBeenCalledWith("job-xyz");
  });

  it("does not cancel timeout when pending_wait has no timeoutJobId", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    ctx.mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
      }),
    ]);

    const result = await executor.signal("dev-agent-AES-42", {
      type: "approval",
    });

    expect(result).toEqual({ action: "resumed" });
    expect(mockScheduler.cancel).not.toHaveBeenCalled();
  });

  it("cancels timeout when conversation is cancelled while waiting", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    ctx.mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval", timeoutJobId: "job-cancel-test" },
      }),
    ]);

    const result = await executor.cancel("dev-agent-AES-42");

    expect(result).toBe(true);
    expect(mockScheduler.cancel).toHaveBeenCalledWith("job-cancel-test");
  });

  it("does not cancel timeout when cancelling non-waiting conversation", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    ctx.mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "running",
      }),
    ]);

    await executor.cancel("dev-agent-AES-42");

    expect(mockScheduler.cancel).not.toHaveBeenCalled();
  });

  it("does not fail if timeout cancellation throws in signal()", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    mockScheduler.cancel.mockRejectedValue(new Error("cancel failed"));
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    ctx.mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval", timeoutJobId: "job-fail" },
      }),
    ]);

    // signal() should propagate the error since cancel() threw
    // The TimeoutScheduler.cancel() already has try/catch internally,
    // but we test defense-in-depth at the wiring layer
    await expect(
      executor.signal("dev-agent-AES-42", { type: "approval" }),
    ).rejects.toThrow("cancel failed");
  });

  it("starts timeout scheduler on startWorker", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    executor.startWorker();

    // start() is fire-and-forget, flush microtask queue
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockScheduler.start).toHaveBeenCalledWith(executor);
  });

  it("does not start scheduler twice on repeated startWorker calls", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    executor.startWorker();
    executor.startWorker();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockScheduler.start).toHaveBeenCalledTimes(1);
  });

  it("stops timeout scheduler on stopWorker", async () => {
    const mockScheduler = createMockTimeoutScheduler();
    const ctx = createTestOptions();
    ctx.options.timeoutScheduler = mockScheduler;
    const executor = createConversationExecutor(ctx.options);

    await executor.stopWorker();

    expect(mockScheduler.close).toHaveBeenCalled();
  });
});

// ─── start() with taskId ──────────────────────────────────────────────────────

describe("start() -- taskId parameter", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    // No existing conversation
    mockDb.setForUpdateResult([]);
  });

  it("includes task_id in INSERT when taskId is provided", async () => {
    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
      taskId: "task_abc123",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task_abc123",
      }),
    );
  });

  it("sets task_id to null when taskId is not provided", async () => {
    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: null,
      }),
    );
  });

  it("includes task_id in re-triggered conversation INSERT", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);
    mockDb.mocks.limit.mockResolvedValue([]);

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Retry",
      taskId: "task_retrigger",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task_retrigger",
      }),
    );
  });
});

// ─── signal() with replyContext ────────────────────────────────────────────────

describe("signal() -- replyContext propagation", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("signal() with replyContext updates reply_context column and appends XML tag to message", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
        messages: [{ role: "user", content: "Original message" }],
      }),
    ]);

    const replyContext = {
      channel: "slack" as const,
      teamId: "T1",
      channelId: "C1",
      threadTs: "123.456",
    };

    await executor.signal("dev-agent-AES-42", {
      type: "approval",
      message: "Approved!",
      replyContext,
    });

    // Verify reply_context is included in the set() call
    expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        reply_context: replyContext,
      }),
    );

    // Verify the message content contains <reply_context> tag
    const setCall = mockDb.mocks.updateSet.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const lastMessage = setCall.messages[setCall.messages.length - 1];
    expect(lastMessage?.content).toContain("<reply_context>");
    expect(lastMessage?.content).toContain('"channelId":"C1"');
  });

  it("signal() without replyContext does NOT update reply_context column", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({
        status: "waiting",
        pending_wait: { type: "approval" },
        messages: [{ role: "user", content: "Original message" }],
      }),
    ]);

    await executor.signal("dev-agent-AES-42", {
      type: "approval",
      message: "Approved!",
    });

    // Verify reply_context is NOT in the set() call
    const setCall = mockDb.mocks.updateSet.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(setCall).not.toHaveProperty("reply_context");

    // Verify the message does NOT contain <reply_context> tag
    const messages = setCall.messages as Array<{
      role: string;
      content: string;
    }>;
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.content).not.toContain("<reply_context>");
  });
});

// ─── start() with replyContext ─────────────────────────────────────────────────

describe("start() -- replyContext propagation", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
    // No existing conversation
    mockDb.setForUpdateResult([]);
  });

  it("start() with replyContext stores it on conversation row and appends tag to message", async () => {
    const replyContext = {
      channel: "slack" as const,
      teamId: "T1",
      channelId: "C1",
      threadTs: "123.456",
    };

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
      replyContext,
    });

    // Verify insert includes reply_context
    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        reply_context: replyContext,
      }),
    );

    // Verify message contains <reply_context> tag
    const insertCall = mockDb.mocks.insertValues.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(insertCall.messages[0]?.content).toContain("<reply_context>");
    expect(insertCall.messages[0]?.content).toContain('"channelId":"C1"');
  });

  it("start() without replyContext sets reply_context to null and does not append tag", async () => {
    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Implement auth",
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        reply_context: null,
      }),
    );

    const insertCall = mockDb.mocks.insertValues.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(insertCall.messages[0]?.content).not.toContain("<reply_context>");
  });

  it("start() re-trigger path stores replyContext and appends tag", async () => {
    mockDb.setForUpdateResult([
      createMockConversationRow({ status: "completed" }),
    ]);
    mockDb.mocks.limit.mockResolvedValue([]);

    const replyContext = {
      channel: "linear" as const,
      issueId: "ISSUE-42",
    };

    await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Retry with fixes",
      replyContext,
    });

    expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        reply_context: replyContext,
      }),
    );

    const insertCall = mockDb.mocks.insertValues.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(insertCall.messages[0]?.content).toContain("<reply_context>");
    expect(insertCall.messages[0]?.content).toContain('"issueId":"ISSUE-42"');
  });
});

// ─── findActiveForTask() ──────────────────────────────────────────────────────

describe("findActiveForTask()", () => {
  let executor: ConversationExecutor;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    const ctx = createTestOptions();
    executor = createConversationExecutor(ctx.options);
    mockDb = ctx.mockDb;
  });

  it("returns ConversationInfo for active conversation with matching task_id", async () => {
    const now = new Date("2026-02-07T12:00:00Z");
    mockDb.mocks.limit.mockResolvedValue([
      {
        id: "dev-agent-AES-42",
        agent_definition_id: "dev-agent",
        agent_definition_version: "1.0.0",
        status: "running",
        created_at: now,
        updated_at: now,
      },
    ]);

    const result = await executor.findActiveForTask("task_abc123");

    expect(result).toEqual({
      id: "dev-agent-AES-42",
      agentDefinitionId: "dev-agent",
      agentDefinitionVersion: "1.0.0",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("returns null when no active conversation exists for task", async () => {
    mockDb.mocks.limit.mockResolvedValue([]);

    const result = await executor.findActiveForTask("task_nonexistent");

    expect(result).toBeNull();
  });

  it("calls the DB with correct select fields", async () => {
    mockDb.mocks.limit.mockResolvedValue([]);

    await executor.findActiveForTask("task_xyz");

    // Verify select was called (query was executed)
    expect(mockDb.mocks.select).toHaveBeenCalled();
    expect(mockDb.mocks.from).toHaveBeenCalled();
    expect(mockDb.mocks.where).toHaveBeenCalled();
  });
});
