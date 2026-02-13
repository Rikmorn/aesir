/**
 * Worker Loop Tests
 *
 * Tests for createWorkerLoop() covering: claiming, heartbeat, stale recovery,
 * execution outcomes (completed, waiting, error, aborted), ownership verification,
 * retry semantics, graceful shutdown, and queued signal consumption.
 *
 * Strategy: Use very short poll intervals (10ms) with real timers and `close()`
 * to ensure all async operations complete before assertions. The fire-and-forget
 * nature of executeConversation makes fake timer testing fragile, so we use
 * small delays with real async completion instead.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

// Mock runAgentLoop before importing the module under test
vi.mock("../shared/agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock @aesir/platform to intercept createDevContainerGit (sandbox tests)
vi.mock("@aesir/platform", () => ({
  createDevContainerGit: vi.fn(),
}));

// Mock MCP client for activity emission tests (dynamic import in worker-loop)
const mockCallMcpTool = vi.fn().mockResolvedValue(undefined);
vi.mock("../shared/mcp/client.js", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
}));

import { createDevContainerGit } from "@aesir/platform";
import { runAgentLoop } from "../shared/agent-loop/run-agent-loop.js";
import type { AgentLoopResult } from "../shared/agent-loop/types.js";
import type {
  AgentDefinition,
  AgentRegistry,
  EventLog,
  SessionProjection,
  ToolRegistry,
} from "./types.js";
import { createWorkerLoop, type WorkerLoopOptions } from "./worker-loop.js";

const mockRunAgentLoop = runAgentLoop as Mock;
const mockCreateDevContainerGit = createDevContainerGit as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Small delay to allow fire-and-forget async work to settle. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

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
  task_id: string | null;
  reply_context: Record<string, unknown> | null;
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
    task_id: null,
    reply_context: null,
    created_at: new Date("2026-02-01T00:00:00Z"),
    updated_at: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

function createMockDb() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const executeFn = vi.fn().mockResolvedValue({ rows: [] });

  return {
    db: {
      select: selectFn,
      update: updateFn,
      execute: executeFn,
    },
    mocks: {
      select: selectFn,
      selectFrom,
      selectWhere,
      update: updateFn,
      updateSet,
      updateWhere,
      execute: executeFn,
    },
    setExecuteResult(rows: MockConversationRow[]) {
      executeFn.mockResolvedValue({ rows });
    },
    setSelectWhereResult(rows: unknown[]) {
      selectWhere.mockResolvedValue(rows);
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
    append: vi.fn() as Mock,
    query: vi.fn().mockResolvedValue([]) as Mock,
    subscribe: vi.fn().mockReturnValue(() => {}) as Mock,
    flush: vi.fn().mockResolvedValue(undefined) as Mock,
    close: vi.fn().mockResolvedValue(undefined) as Mock,
    initSequence: vi.fn().mockResolvedValue(undefined) as Mock,
  } satisfies EventLog;
}

function createMockSessionProjection() {
  return {
    getSession: vi.fn().mockResolvedValue(null) as Mock,
    close: vi.fn() as Mock,
  } satisfies SessionProjection;
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
      pruneThreshold: 100000,
      protectedMessages: 5,
      summaryThreshold: 50000,
      summaryModel: "claude-sonnet-4-20250514",
    },
    systemPrompt: "You are a dev agent.",
    ...overrides,
  };
}

function createMockAgentRegistry(): AgentRegistry & { get: Mock } {
  return {
    get: vi.fn().mockResolvedValue(createMockAgentDefinition()),
    list: vi.fn().mockResolvedValue([createMockAgentDefinition()]),
  };
}

function createMockToolRegistry() {
  return {
    register: vi.fn(),
    resolve: vi.fn().mockReturnValue([]) as Mock,
    has: vi.fn().mockReturnValue(true),
    listRegistered: vi.fn().mockReturnValue([]),
  } satisfies ToolRegistry;
}

function createMockSandboxManager() {
  return {
    spawn: vi.fn().mockResolvedValue(undefined) as Mock,
    execute: vi
      .fn()
      .mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" }) as Mock,
    findByTaskId: vi.fn().mockResolvedValue(null) as Mock,
    isRunning: vi.fn().mockResolvedValue(false) as Mock,
    health: vi.fn().mockResolvedValue({ healthy: true, containers: 0 }) as Mock,
    close: vi.fn().mockResolvedValue(undefined) as Mock,
  };
}

function createDefaultLoopResult(
  overrides?: Partial<AgentLoopResult>,
): AgentLoopResult {
  return {
    status: "completed",
    output: "Task done",
    toolCallCount: 3,
    tokenCount: { input: 1000, output: 500 },
    trace: [],
    messages: [],
    ...overrides,
  };
}

function createTestOptions() {
  const mockDb = createMockDb();
  const mockEventLog = createMockEventLog();
  const mockSessionProjection = createMockSessionProjection();
  const mockAgentRegistry = createMockAgentRegistry();
  const mockToolRegistry = createMockToolRegistry();
  const mockLogger = createMockLogger();

  const options: WorkerLoopOptions = {
    db: mockDb.db as unknown as WorkerLoopOptions["db"],
    eventLog: mockEventLog,
    sessionProjection: mockSessionProjection,
    agentRegistry: mockAgentRegistry,
    toolRegistry: mockToolRegistry,
    logger: mockLogger as unknown as WorkerLoopOptions["logger"],
    pollIntervalMs: 10, // Very fast for tests
    concurrencyLimit: 3,
    heartbeatIntervalMs: 30000,
    staleThresholdMs: 300000,
    workerId: "wrkr_test",
  };

  return {
    options,
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

describe("createWorkerLoop", () => {
  beforeEach(() => {
    mockRunAgentLoop.mockReset();
    mockRunAgentLoop.mockResolvedValue(createDefaultLoopResult());
    mockCallMcpTool.mockReset();
    mockCallMcpTool.mockResolvedValue(undefined);
    mockCreateDevContainerGit.mockReset();
    mockCreateDevContainerGit.mockReturnValue({
      configureCredentials: vi.fn().mockResolvedValue(undefined),
      cloneRepository: vi
        .fn()
        .mockResolvedValue({ success: true, stdout: "", stderr: "" }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Claiming ──────────────────────────────────────────────────────────

  describe("claiming", () => {
    it("should claim queued conversations up to concurrency limit", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockDb.mocks.execute).toHaveBeenCalled();
    });

    it("should not claim when at concurrency limit", async () => {
      const { options, mockDb } = createTestOptions();
      options.concurrencyLimit = 1;

      let resolveExecution: () => void = () => {};
      const blockPromise = new Promise<void>((r) => {
        resolveExecution = r;
      });
      mockRunAgentLoop.mockReturnValue(
        blockPromise.then(() => createDefaultLoopResult()),
      );

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();

      expect(loop.getRunningCount()).toBe(1);

      // Complete the execution
      resolveExecution();
      await tick();
      await loop.close();
    });

    it("should use SKIP LOCKED in claim SQL", async () => {
      const { options, mockDb } = createTestOptions();
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const executeCall = mockDb.mocks.execute.mock.calls[0] as
        | unknown[]
        | undefined;
      expect(executeCall).toBeDefined();
      const sqlString = JSON.stringify(executeCall?.[0]);
      expect(sqlString).toContain("SKIP LOCKED");
    });

    it("should set claimed_by to worker ID in claim SQL", async () => {
      const { options, mockDb } = createTestOptions();
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const executeCall = mockDb.mocks.execute.mock.calls[0] as
        | unknown[]
        | undefined;
      const sqlString = JSON.stringify(executeCall?.[0]);
      expect(sqlString).toContain("wrkr_test");
    });

    it("should set status to running on claim", async () => {
      const { options, mockDb } = createTestOptions();
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const sqlString = JSON.stringify(mockDb.mocks.execute.mock.calls[0]?.[0]);
      expect(sqlString).toContain("running");
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────

  describe("heartbeat", () => {
    it("should update heartbeat when interval has elapsed", async () => {
      const { options, mockDb } = createTestOptions();
      options.heartbeatIntervalMs = 10; // Very short

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      mockRunAgentLoop.mockImplementation(
        async (opts: { onHeartbeat?: () => void }) => {
          // Wait real 20ms so heartbeat interval (10ms) elapses
          await new Promise((r) => setTimeout(r, 20));
          opts.onHeartbeat?.();
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick(100);
      await loop.close();

      // The update mock should be called multiple times:
      // at least once for heartbeat and once for status transition
      expect(mockDb.mocks.update).toHaveBeenCalled();
    });

    it("should not update heartbeat before interval elapses", async () => {
      const { options, mockDb } = createTestOptions();
      options.heartbeatIntervalMs = 60000; // 60s -- will never elapse

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      let capturedHeartbeat: (() => void) | undefined;
      mockRunAgentLoop.mockImplementation(
        async (opts: { onHeartbeat?: () => void }) => {
          capturedHeartbeat = opts.onHeartbeat;
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();

      // Count update calls before manual heartbeat invocation
      const updatesBefore = mockDb.mocks.update.mock.calls.length;
      capturedHeartbeat?.();
      // No new update calls from heartbeat (interval not elapsed)
      const updatesAfter = mockDb.mocks.update.mock.calls.length;
      // The delta should be 0 (heartbeat didn't fire db.update)
      expect(updatesAfter - updatesBefore).toBe(0);

      await loop.close();
    });

    it("should not crash on heartbeat error", async () => {
      const { options, mockDb } = createTestOptions();
      options.heartbeatIntervalMs = 1;

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      // Override update to reject for the first call (heartbeat), then succeed
      let callCount = 0;
      mockDb.mocks.update.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockRejectedValue(new Error("DB error")),
            }),
          };
        }
        return {
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        };
      });

      mockRunAgentLoop.mockImplementation(
        async (opts: { onHeartbeat?: () => void }) => {
          await new Promise((r) => setTimeout(r, 10));
          opts.onHeartbeat?.();
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick(100);

      // Should not throw -- close completes normally
      await loop.close();
    });
  });

  // ── Stale Recovery ────────────────────────────────────────────────────

  describe("stale recovery", () => {
    it("should re-enqueue conversations with expired heartbeat", async () => {
      const { options, mockDb } = createTestOptions();

      const staleRow = createMockConversationRow({
        id: "stale-conv",
        status: "running",
        last_heartbeat_at: new Date(Date.now() - 600000),
        retry_count: 0,
        max_retries: 2,
      });
      mockDb.setSelectWhereResult([staleRow]);
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const reEnqueueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "queued",
      );
      expect(reEnqueueCall).toBeDefined();
    });

    it("should increment retry_count on stale recovery", async () => {
      const { options, mockDb } = createTestOptions();

      const staleRow = createMockConversationRow({
        id: "stale-conv",
        status: "running",
        last_heartbeat_at: new Date(Date.now() - 600000),
        retry_count: 1,
        max_retries: 2,
      });
      mockDb.setSelectWhereResult([staleRow]);
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const reEnqueueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "queued" &&
          (call[0] as Record<string, unknown>).retry_count === 2,
      );
      expect(reEnqueueCall).toBeDefined();
    });

    it("should set status to failed when retry_count >= max_retries", async () => {
      const { options, mockDb } = createTestOptions();

      const staleRow = createMockConversationRow({
        id: "stale-conv",
        status: "running",
        last_heartbeat_at: new Date(Date.now() - 600000),
        retry_count: 2,
        max_retries: 2,
      });
      mockDb.setSelectWhereResult([staleRow]);
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "failed",
      );
      expect(failCall).toBeDefined();
      expect(
        (failCall?.[0] as Record<string, unknown>)?.error_message,
      ).toContain("Stale heartbeat");
    });

    it("should not touch non-running conversations", async () => {
      const { options, mockDb } = createTestOptions();
      // No stale rows returned
      mockDb.setSelectWhereResult([]);
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // updateSet should not be called (no stale rows, no claimed conversations)
      expect(mockDb.mocks.updateSet).not.toHaveBeenCalled();
    });
  });

  // ── Execution -- Completion ───────────────────────────────────────────

  describe("execution -- completion", () => {
    it("should set status to completed on successful loop exit", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(createDefaultLoopResult());

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
    });

    it("should persist messages on completed loop", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Do something" }],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
      expect(
        (completedCall?.[0] as Record<string, unknown>)?.messages,
      ).toBeDefined();
    });

    it("should clear claimed_by and claimed_at after completion", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
      const payload = completedCall?.[0] as Record<string, unknown>;
      expect(payload.claimed_by).toBeNull();
      expect(payload.claimed_at).toBeNull();
      expect(payload.last_heartbeat_at).toBeNull();
    });
  });

  // ── Execution -- wait_for Pause ───────────────────────────────────────

  describe("execution -- wait_for pause", () => {
    it("should detect waitForState.triggered and set status to waiting", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      mockToolRegistry.resolve.mockReturnValue([
        {
          name: "wait_for",
          description: "Wait",
          inputSchema: { parse: (v: unknown) => v },
          execute: vi.fn(),
        },
      ]);

      mockRunAgentLoop.mockImplementation(
        async (opts: {
          tools: Array<{
            name: string;
            execute: (input: unknown) => Promise<unknown>;
          }>;
        }) => {
          const wf = opts.tools.find((t) => t.name === "wait_for");
          if (wf) await wf.execute({ type: "approval", reason: "Review" });
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();
    });

    it("should persist pending_wait with wait type and reason", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      mockToolRegistry.resolve.mockReturnValue([
        {
          name: "wait_for",
          description: "Wait",
          inputSchema: { parse: (v: unknown) => v },
          execute: vi.fn(),
        },
      ]);

      mockRunAgentLoop.mockImplementation(
        async (opts: {
          tools: Array<{
            name: string;
            execute: (input: unknown) => Promise<unknown>;
          }>;
        }) => {
          const wf = opts.tools.find((t) => t.name === "wait_for");
          if (wf)
            await wf.execute({
              type: "pr_review",
              reason: "Waiting for review",
              timeout: "72h",
            });
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();
      const pw = (waitingCall?.[0] as Record<string, unknown>)
        ?.pending_wait as Record<string, unknown>;
      expect(pw.types).toEqual(["pr_review"]);
      expect(pw.reason).toBe("Waiting for review");
      expect(pw.timeout).toBe("72h");
    });

    it("should clear claimed_by after pause", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      mockToolRegistry.resolve.mockReturnValue([
        {
          name: "wait_for",
          description: "Wait",
          inputSchema: { parse: (v: unknown) => v },
          execute: vi.fn(),
        },
      ]);

      mockRunAgentLoop.mockImplementation(
        async (opts: {
          tools: Array<{
            name: string;
            execute: (input: unknown) => Promise<unknown>;
          }>;
        }) => {
          const wf = opts.tools.find((t) => t.name === "wait_for");
          if (wf) await wf.execute({ type: "approval", reason: "Review" });
          return createDefaultLoopResult();
        },
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();
      const payload = waitingCall?.[0] as Record<string, unknown>;
      expect(payload.claimed_by).toBeNull();
      expect(payload.claimed_at).toBeNull();
    });
  });

  // ── Execution -- Retry on Error ───────────────────────────────────────

  describe("execution -- retry on error", () => {
    it("should re-enqueue with incremented retry_count on retryable error", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        retry_count: 0,
        max_retries: 2,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(
        createDefaultLoopResult({ status: "error", output: "API error" }),
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const requeueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "queued" &&
          (call[0] as Record<string, unknown>).retry_count === 1,
      );
      expect(requeueCall).toBeDefined();
    });

    it("should set status to failed when max_retries exceeded", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        retry_count: 2,
        max_retries: 2,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(
        createDefaultLoopResult({ status: "error", output: "Error" }),
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "failed",
      );
      expect(failCall).toBeDefined();
    });

    it("should fail immediately on non-retryable error (token budget)", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        retry_count: 0,
        max_retries: 2,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(
        createDefaultLoopResult({
          status: "max_tokens",
          output: "Token budget exhausted",
        }),
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "failed",
      );
      expect(failCall).toBeDefined();

      const requeueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "queued" &&
          (call[0] as Record<string, unknown>).retry_count === 1,
      );
      expect(requeueCall).toBeUndefined();
    });
  });

  // ── Ownership Verification ────────────────────────────────────────────

  describe("ownership verification", () => {
    it("should discard results if claimed_by changed", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      // Ownership lost
      mockDb.setSelectWhereResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeUndefined();
    });

    it("should persist normally if ownership still valid", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
    });
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────

  describe("graceful shutdown", () => {
    it("should stop claiming new conversations after drain", async () => {
      const { options, mockDb } = createTestOptions();
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.drain();

      expect(loop.isRunning()).toBe(false);
    });

    it("should wait for running conversations to finish during drain", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      let resolveExecution: () => void = () => {};
      const blockPromise = new Promise<void>((r) => {
        resolveExecution = r;
      });
      mockRunAgentLoop.mockReturnValue(
        blockPromise.then(() => createDefaultLoopResult()),
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();

      expect(loop.getRunningCount()).toBe(1);

      // Start drain (will block until execution completes)
      const drainPromise = loop.drain();

      // Still running
      await tick(20);
      expect(loop.getRunningCount()).toBe(1);

      // Resolve execution
      resolveExecution();
      await drainPromise;

      expect(loop.getRunningCount()).toBe(0);
    });

    it("should flush eventLog after drain on close", async () => {
      const { options, mockDb, mockEventLog } = createTestOptions();
      mockDb.setExecuteResult([]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockEventLog.flush).toHaveBeenCalled();
    });
  });

  // ── Queued Signal Consumption ─────────────────────────────────────────

  describe("queued signal consumption", () => {
    it("should consume matching queued signal before agent loop run", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Initial task" }],
        pending_wait: { type: "approval" },
        queued_signals: [
          {
            type: "approval",
            data: { approved: true },
            message: "Approved!",
          },
        ],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const signalConsumeCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).pending_wait === null &&
          Array.isArray((call[0] as Record<string, unknown>).queued_signals) &&
          ((call[0] as Record<string, unknown>).queued_signals as unknown[])
            .length === 0,
      );
      expect(signalConsumeCall).toBeDefined();

      // Verify signal message was appended to messages
      const msgs = (signalConsumeCall?.[0] as Record<string, unknown>)
        ?.messages as unknown[];
      expect(msgs).toHaveLength(2);
      const signalMsg = msgs[1] as Record<string, unknown>;
      expect(signalMsg.role).toBe("user");
      expect(signalMsg.content).toBe("Approved!");
    });

    it("should append replyContext tag to signal message when replyContext is present", async () => {
      const { options, mockDb } = createTestOptions();
      const slackReplyContext = {
        channel: "slack",
        teamId: "T789",
        channelId: "C123",
        threadTs: "1234567890.000000",
      };
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Initial task" }],
        pending_wait: { type: "approval" },
        queued_signals: [
          {
            type: "approval",
            data: { approved: true },
            message: "Approved!",
            replyContext: slackReplyContext,
          },
        ],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const signalConsumeCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).pending_wait === null &&
          Array.isArray((call[0] as Record<string, unknown>).queued_signals) &&
          ((call[0] as Record<string, unknown>).queued_signals as unknown[])
            .length === 0,
      );
      expect(signalConsumeCall).toBeDefined();

      // Verify the signal message includes the reply_context XML tag
      const msgs = (signalConsumeCall?.[0] as Record<string, unknown>)
        ?.messages as unknown[];
      expect(msgs).toHaveLength(2);
      const signalMsg = msgs[1] as Record<string, unknown>;
      expect(signalMsg.role).toBe("user");
      expect(signalMsg.content).toContain("<reply_context>");
      expect(signalMsg.content).toContain(JSON.stringify(slackReplyContext));
    });

    it("should leave non-matching queued signals untouched", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Initial task" }],
        pending_wait: { type: "approval" },
        queued_signals: [{ type: "pr_review", data: { ok: true } }],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      // Should NOT find a call that cleared pending_wait and emptied queued_signals
      const consumeCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).pending_wait === null &&
          Array.isArray((call[0] as Record<string, unknown>).queued_signals) &&
          ((call[0] as Record<string, unknown>).queued_signals as unknown[])
            .length === 0,
      );
      expect(consumeCall).toBeUndefined();
    });
  });

  // ── Aborted Status ────────────────────────────────────────────────────

  describe("execution -- aborted", () => {
    it("should re-enqueue conversation when agent loop is aborted", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(
        createDefaultLoopResult({ status: "aborted", output: "" }),
      );

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const requeueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "queued" &&
          (call[0] as Record<string, unknown>).claimed_by === null,
      );
      expect(requeueCall).toBeDefined();
    });
  });

  // ── Agent Definition Not Found ────────────────────────────────────────

  describe("agent definition not found", () => {
    it("should mark conversation failed if agent definition not found", async () => {
      const { options, mockDb, mockAgentRegistry } = createTestOptions();
      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockAgentRegistry.get.mockResolvedValue(null);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "failed" &&
          (
            (call[0] as Record<string, unknown>).error_message as string
          )?.includes("Agent definition not found"),
      );
      expect(failCall).toBeDefined();
    });
  });

  // ── Timeout Scheduling ────────────────────────────────────────────────

  describe("timeout scheduling", () => {
    function createMockTimeoutScheduler() {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        schedule: vi.fn().mockResolvedValue("timeout-job-123"),
        cancel: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    function setupWaitForTest(
      testOptions: ReturnType<typeof createTestOptions>,
      waitForInput: Record<string, unknown>,
    ) {
      testOptions.mockToolRegistry.resolve.mockReturnValue([
        {
          name: "wait_for",
          description: "Wait",
          inputSchema: { parse: (v: unknown) => v },
          execute: vi.fn(),
        },
      ]);

      mockRunAgentLoop.mockImplementation(
        async (opts: {
          tools: Array<{
            name: string;
            execute: (input: unknown) => Promise<unknown>;
          }>;
        }) => {
          const wf = opts.tools.find((t) => t.name === "wait_for");
          if (wf) await wf.execute(waitForInput);
          return createDefaultLoopResult();
        },
      );
    }

    it("should schedule timeout when waitForState has timeout", async () => {
      const testOpts = createTestOptions();
      const mockScheduler = createMockTimeoutScheduler();
      testOpts.options.timeoutScheduler = mockScheduler;

      const conv = createMockConversationRow();
      testOpts.mockDb.setExecuteResult([conv]);
      testOpts.mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      setupWaitForTest(testOpts, {
        type: "approval",
        reason: "Review needed",
        timeout: "72h",
      });

      const loop = createWorkerLoop(testOpts.options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockScheduler.schedule).toHaveBeenCalledWith(
        "dev-agent-AES-42",
        "72h",
        "approval",
        "Review needed",
        undefined,
      );

      // Verify pending_wait includes timeoutJobId
      const setCalls = testOpts.mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();
      const pw = (waitingCall?.[0] as Record<string, unknown>)
        ?.pending_wait as Record<string, unknown>;
      expect(pw.timeoutJobId).toBe("timeout-job-123");
    });

    it("should not schedule timeout when waitForState has no timeout", async () => {
      const testOpts = createTestOptions();
      const mockScheduler = createMockTimeoutScheduler();
      testOpts.options.timeoutScheduler = mockScheduler;

      const conv = createMockConversationRow();
      testOpts.mockDb.setExecuteResult([conv]);
      testOpts.mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      setupWaitForTest(testOpts, {
        type: "approval",
        reason: "Review needed",
        // No timeout specified
      });

      const loop = createWorkerLoop(testOpts.options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockScheduler.schedule).not.toHaveBeenCalled();

      // Verify pending_wait does NOT include timeoutJobId
      const setCalls = testOpts.mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();
      const pw = (waitingCall?.[0] as Record<string, unknown>)
        ?.pending_wait as Record<string, unknown>;
      expect(pw.timeoutJobId).toBeUndefined();
    });

    it("should handle timeout scheduling failure gracefully", async () => {
      const testOpts = createTestOptions();
      const mockScheduler = createMockTimeoutScheduler();
      mockScheduler.schedule.mockRejectedValue(new Error("pg-boss error"));
      testOpts.options.timeoutScheduler = mockScheduler;

      const conv = createMockConversationRow();
      testOpts.mockDb.setExecuteResult([conv]);
      testOpts.mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      setupWaitForTest(testOpts, {
        type: "approval",
        reason: "Review needed",
        timeout: "72h",
      });

      const loop = createWorkerLoop(testOpts.options);
      loop.start();
      await tick();
      await loop.close();

      // Should still transition to waiting (non-fatal error)
      const setCalls = testOpts.mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();

      // pending_wait should NOT include timeoutJobId (schedule failed)
      const pw = (waitingCall?.[0] as Record<string, unknown>)
        ?.pending_wait as Record<string, unknown>;
      expect(pw.timeoutJobId).toBeUndefined();
    });

    it("should not schedule timeout when no timeoutScheduler provided", async () => {
      const testOpts = createTestOptions();
      // No timeoutScheduler in options (default)

      const conv = createMockConversationRow();
      testOpts.mockDb.setExecuteResult([conv]);
      testOpts.mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      setupWaitForTest(testOpts, {
        type: "approval",
        reason: "Review needed",
        timeout: "72h",
      });

      const loop = createWorkerLoop(testOpts.options);
      loop.start();
      await tick();
      await loop.close();

      // Should still transition to waiting normally
      const setCalls = testOpts.mockDb.mocks.updateSet.mock.calls;
      const waitingCall = setCalls.find(
        (call: unknown[]) =>
          call[0] && (call[0] as Record<string, unknown>).status === "waiting",
      );
      expect(waitingCall).toBeDefined();

      // pending_wait should NOT include timeoutJobId
      const pw = (waitingCall?.[0] as Record<string, unknown>)
        ?.pending_wait as Record<string, unknown>;
      expect(pw.timeoutJobId).toBeUndefined();
    });
  });

  // ── Sandbox Setup ────────────────────────────────────────────────────

  describe("sandbox setup", () => {
    it("should spawn sandbox container when agent has codebase tools", async () => {
      const { options, mockDb } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      options.sandboxManager = mockSandbox;

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockSandbox.spawn).toHaveBeenCalledWith({
        taskId: "dev-agent-AES-42",
      });
    });

    it("should skip sandbox setup when agent has no codebase tools", async () => {
      const { options, mockDb, mockAgentRegistry } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      options.sandboxManager = mockSandbox;

      mockAgentRegistry.get.mockResolvedValue(
        createMockAgentDefinition({
          tools: ["integration:slack:send_message"],
        }),
      );

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockSandbox.spawn).not.toHaveBeenCalled();
    });

    it("should not spawn sandbox when no sandboxManager configured", async () => {
      const { options, mockDb } = createTestOptions();
      // No sandboxManager in options (default)

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Should complete without error -- sandbox setup simply skipped
      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
    });

    it("should include containerManager and sandboxId in ToolContext when sandbox is available", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      options.sandboxManager = mockSandbox;

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Check the ToolContext passed to toolRegistry.resolve
      const resolveCall = mockToolRegistry.resolve.mock.calls[0];
      const toolContext = resolveCall?.[1] as Record<string, unknown>;
      expect(toolContext.containerManager).toBe(mockSandbox);
      expect(toolContext.sandboxId).toBe("dev-agent-AES-42");
    });

    it("should not include containerManager in ToolContext when no sandboxManager configured", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();
      // No sandboxManager in options (default)

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const resolveCall = mockToolRegistry.resolve.mock.calls[0];
      const toolContext = resolveCall?.[1] as Record<string, unknown>;
      expect(toolContext.containerManager).toBeUndefined();
      expect(toolContext.sandboxId).toBeUndefined();
    });

    it("should clone repo when sandboxSetup is provided", async () => {
      const { options, mockDb } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      options.sandboxManager = mockSandbox;
      options.sandboxSetup = {
        repoUrl: "https://github.com/org/repo.git",
        githubToken: "ghp_test123",
        baseBranch: "main",
      };

      const mockGit = {
        configureCredentials: vi.fn().mockResolvedValue(undefined),
        cloneRepository: vi
          .fn()
          .mockResolvedValue({ success: true, stdout: "", stderr: "" }),
      };
      mockCreateDevContainerGit.mockReturnValue(mockGit);

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockGit.configureCredentials).toHaveBeenCalledWith(
        "dev-agent-AES-42",
        "ghp_test123",
      );
      expect(mockGit.cloneRepository).toHaveBeenCalledWith(
        "dev-agent-AES-42",
        "https://github.com/org/repo.git",
        { branch: "main" },
      );
    });

    it("should skip repo clone when repo already exists in sandbox", async () => {
      const { options, mockDb } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      // Return exitCode 0 = repo already exists
      mockSandbox.execute.mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      options.sandboxManager = mockSandbox;
      options.sandboxSetup = {
        repoUrl: "https://github.com/org/repo.git",
      };

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      expect(mockSandbox.spawn).toHaveBeenCalled();
      expect(mockCreateDevContainerGit).not.toHaveBeenCalled();
    });

    it("should retry conversation when sandbox setup fails", async () => {
      const { options, mockDb } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      mockSandbox.spawn.mockRejectedValue(
        new Error("Docker daemon unavailable"),
      );
      options.sandboxManager = mockSandbox;

      const conv = createMockConversationRow({
        retry_count: 0,
        max_retries: 2,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const requeueCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "queued" &&
          (call[0] as Record<string, unknown>).retry_count === 1,
      );
      expect(requeueCall).toBeDefined();
    });

    it("should fail conversation when sandbox setup fails and retries exhausted", async () => {
      const { options, mockDb } = createTestOptions();
      const mockSandbox = createMockSandboxManager();
      mockSandbox.spawn.mockRejectedValue(
        new Error("Docker daemon unavailable"),
      );
      options.sandboxManager = mockSandbox;

      const conv = createMockConversationRow({
        retry_count: 2,
        max_retries: 2,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      // Find the specific sandbox error (not the stale recovery error)
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "failed" &&
          (
            (call[0] as Record<string, unknown>).error_message as string
          )?.includes("Docker daemon unavailable"),
      );
      expect(failCall).toBeDefined();
    });
  });

  // ── Lifecycle Events ──────────────────────────────────────────────────

  describe("lifecycle events", () => {
    it("should append agent.started event for new conversations", async () => {
      const { options, mockDb, mockEventLog } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Do something" }],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const appendCalls = mockEventLog.append.mock.calls;
      const startedEvent = appendCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).type === "agent.started",
      );
      expect(startedEvent).toBeDefined();
    });

    it("should append agent.resumed event for resumed conversations", async () => {
      const { options, mockDb, mockEventLog } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [
          { role: "user", content: "Do something" },
          { role: "assistant", content: "Working" },
        ],
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const appendCalls = mockEventLog.append.mock.calls;
      const resumedEvent = appendCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).type === "agent.resumed",
      );
      expect(resumedEvent).toBeDefined();
    });
  });

  // ── Sub-agent Spawn Wiring ───────────────────────────────────────────

  describe("sub-agent spawn wiring", () => {
    it("should populate spawnDeps when agent has coordination:spawn_agent", async () => {
      const { options, mockDb, mockToolRegistry, mockAgentRegistry } =
        createTestOptions();

      mockAgentRegistry.get.mockResolvedValue(
        createMockAgentDefinition({
          tools: ["codebase:read_file", "coordination:spawn_agent"],
          subAgents: { researcher: "researcher" },
          tokenBudget: 200000,
        }),
      );

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Check the ToolContext passed to toolRegistry.resolve
      const resolveCall = mockToolRegistry.resolve.mock.calls[0];
      const toolContext = resolveCall?.[1] as Record<string, unknown>;
      expect(toolContext.spawnDeps).toBeDefined();

      const spawnDeps = toolContext.spawnDeps as Record<string, unknown>;
      expect(spawnDeps.agentRegistry).toBeDefined();
      expect(spawnDeps.toolRegistry).toBeDefined();
      expect(spawnDeps.tokenBudget).toBeDefined();
      expect(spawnDeps.eventLog).toBeDefined();
      expect(spawnDeps.currentDepth).toBe(0);
      expect(spawnDeps.maxSpawnDepth).toBe(3);
    });

    it("should not populate spawnDeps when agent lacks coordination:spawn_agent", async () => {
      const { options, mockDb, mockToolRegistry } = createTestOptions();

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Check the ToolContext passed to toolRegistry.resolve
      const resolveCall = mockToolRegistry.resolve.mock.calls[0];
      const toolContext = resolveCall?.[1] as Record<string, unknown>;
      expect(toolContext.spawnDeps).toBeUndefined();
    });

    it("should fail fast when sub-agent definition not found", async () => {
      const { options, mockDb, mockAgentRegistry } = createTestOptions();

      // First call returns parent definition with subAgents
      // Second call (for sub-agent) returns null
      mockAgentRegistry.get
        .mockResolvedValueOnce(
          createMockAgentDefinition({
            tools: ["codebase:read_file", "coordination:spawn_agent"],
            subAgents: { researcher: "researcher", coder: "coder" },
          }),
        )
        .mockResolvedValueOnce(null); // researcher not found

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const failCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "failed" &&
          (
            (call[0] as Record<string, unknown>).error_message as string
          )?.includes("Sub-agent definition not found"),
      );
      expect(failCall).toBeDefined();
      const errorMessage = (failCall?.[0] as Record<string, unknown>)
        ?.error_message as string;
      expect(errorMessage).toContain("researcher");
    });

    it("should create token budget from definition.tokenBudget when agent has spawn_agent", async () => {
      const { options, mockDb, mockAgentRegistry } = createTestOptions();

      mockAgentRegistry.get.mockResolvedValue(
        createMockAgentDefinition({
          tools: ["codebase:read_file", "coordination:spawn_agent"],
          subAgents: { researcher: "researcher" },
          tokenBudget: 250000,
        }),
      );

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Verify tokenBudget was passed to runAgentLoop
      const loopCall = mockRunAgentLoop.mock.calls[0];
      const loopOpts = loopCall?.[0] as Record<string, unknown>;
      expect(loopOpts.tokenBudget).toBeDefined();
      const budget = loopOpts.tokenBudget as {
        total: number;
        remaining: number;
      };
      expect(budget.total).toBe(250000);
      expect(budget.remaining).toBe(250000);
    });

    it("should not create token budget when agent lacks spawn_agent", async () => {
      const { options, mockDb } = createTestOptions();

      const conv = createMockConversationRow();
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Verify tokenBudget was NOT passed to runAgentLoop
      const loopCall = mockRunAgentLoop.mock.calls[0];
      const loopOpts = loopCall?.[0] as Record<string, unknown>;
      expect(loopOpts.tokenBudget).toBeUndefined();
    });
  });

  // ── Activity Emission (Resume & Completion) ──────────────────────────

  describe("activity emission", () => {
    it("should emit resume activity on resume with Linear session", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [
          { role: "user", content: "Do something" },
          { role: "assistant", content: "Working on it" },
        ],
        reply_context: {
          channel: "linear",
          agentSessionId: "sess_123",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Find the resume activity call (type: "thought")
      const resumeCall = mockCallMcpTool.mock.calls.find((call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        const params = arg.params as Record<string, unknown>;
        return (
          arg.tool === "create_agent_activity" && params.type === "thought"
        );
      });
      expect(resumeCall).toBeDefined();
      const resumeArg = resumeCall?.[0] as Record<string, unknown>;
      expect(resumeArg.integration).toBe("linear");
      const resumeParams = resumeArg.params as Record<string, unknown>;
      expect(resumeParams.agentSessionId).toBe("sess_123");
      expect(resumeParams.body).toBe("Resuming work...");
    });

    it("should skip resume activity when no Linear session", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [
          { role: "user", content: "Do something" },
          { role: "assistant", content: "Working on it" },
        ],
        reply_context: {
          channel: "slack",
          threadTs: "123",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // No call with type "thought" should exist
      const resumeCall = mockCallMcpTool.mock.calls.find((call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        const params = arg.params as Record<string, unknown>;
        return (
          arg.tool === "create_agent_activity" && params.type === "thought"
        );
      });
      expect(resumeCall).toBeUndefined();
    });

    it("should skip resume activity for new conversations (not resumed)", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [{ role: "user", content: "Do something" }],
        reply_context: {
          channel: "linear",
          agentSessionId: "sess_456",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // No call with type "thought" should exist (not resumed)
      const resumeCall = mockCallMcpTool.mock.calls.find((call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        const params = arg.params as Record<string, unknown>;
        return (
          arg.tool === "create_agent_activity" && params.type === "thought"
        );
      });
      expect(resumeCall).toBeUndefined();
    });

    it("should emit completion activity on completed conversation with Linear session", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        reply_context: {
          channel: "linear",
          agentSessionId: "sess_789",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(createDefaultLoopResult());

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Find the completion activity call (type: "response")
      const completionCall = mockCallMcpTool.mock.calls.find(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          const params = arg.params as Record<string, unknown>;
          return (
            arg.tool === "create_agent_activity" && params.type === "response"
          );
        },
      );
      expect(completionCall).toBeDefined();
      const completionArg = completionCall?.[0] as Record<string, unknown>;
      expect(completionArg.integration).toBe("linear");
      const completionParams = completionArg.params as Record<string, unknown>;
      expect(completionParams.agentSessionId).toBe("sess_789");
      expect(completionParams.body).toBe("Task completed.");
    });

    it("should skip completion activity when no Linear session", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        reply_context: null,
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(createDefaultLoopResult());

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // No call with type "response" should exist
      const completionCall = mockCallMcpTool.mock.calls.find(
        (call: unknown[]) => {
          const arg = call[0] as Record<string, unknown>;
          const params = arg.params as Record<string, unknown>;
          return (
            arg.tool === "create_agent_activity" && params.type === "response"
          );
        },
      );
      expect(completionCall).toBeUndefined();
    });

    it("should not crash executor when activity emission fails", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        reply_context: {
          channel: "linear",
          agentSessionId: "sess_fail",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);
      mockRunAgentLoop.mockResolvedValue(createDefaultLoopResult());

      // Make callMcpTool throw for all calls
      mockCallMcpTool.mockRejectedValue(new Error("MCP connection refused"));

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Conversation should still complete successfully despite activity emission failure
      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
    });

    it("should not crash executor when resume activity emission fails", async () => {
      const { options, mockDb } = createTestOptions();
      const conv = createMockConversationRow({
        messages: [
          { role: "user", content: "Do something" },
          { role: "assistant", content: "Working on it" },
        ],
        reply_context: {
          channel: "linear",
          agentSessionId: "sess_fail2",
        },
      });
      mockDb.setExecuteResult([conv]);
      mockDb.setSelectWhereResult([{ claimed_by: "wrkr_test" }]);

      // Make callMcpTool throw for all calls
      mockCallMcpTool.mockRejectedValue(new Error("MCP timeout"));

      const loop = createWorkerLoop(options);
      loop.start();
      await tick();
      await loop.close();

      // Conversation should still complete successfully despite resume activity failure
      const setCalls = mockDb.mocks.updateSet.mock.calls;
      const completedCall = setCalls.find(
        (call: unknown[]) =>
          call[0] &&
          (call[0] as Record<string, unknown>).status === "completed",
      );
      expect(completedCall).toBeDefined();
    });
  });
});
