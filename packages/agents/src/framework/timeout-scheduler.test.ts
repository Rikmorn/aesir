/**
 * Timeout Scheduler Tests
 *
 * Unit tests for TimeoutScheduler factory, IDatabase adapter,
 * and duration parser. Uses mocked pg-boss to verify scheduling,
 * cancellation, and signal delivery behavior.
 */

import type { Pool } from "pg";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ConversationExecutor, Signal } from "./types.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockBoss, MockPgBossClass } = vi.hoisted(() => {
  const mockBoss = {
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue("job-id-123"),
    cancel: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue("worker-id-1"),
    createQueue: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  };

  // Use a function constructor so `new PgBoss(...)` works
  const MockPgBossClass = vi.fn(function mockPgBoss() {
    return mockBoss;
  });

  return { mockBoss, MockPgBossClass };
});

vi.mock("pg-boss", () => ({
  PgBoss: MockPgBossClass,
}));

function createMockPool(): { query: Mock } {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
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

function createMockExecutor(): ConversationExecutor {
  return {
    start: vi.fn().mockResolvedValue("conv-123"),
    signal: vi.fn().mockResolvedValue({ action: "resumed" }),
    get: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(true),
    reopen: vi.fn().mockResolvedValue({ action: "reopened" }),
    list: vi.fn().mockResolvedValue([]),
    startWorker: vi.fn(),
    stopWorker: vi.fn().mockResolvedValue(undefined),
    getWorkerStatus: vi.fn().mockReturnValue(null),
  };
}

function createSchedulerOptions(
  overrides?: Partial<{
    pool: { query: Mock };
    logger: ReturnType<typeof createMockLogger>;
    schema: string;
  }>,
): TimeoutSchedulerOptions {
  const pool = overrides?.pool ?? createMockPool();
  const logger = overrides?.logger ?? createMockLogger();
  return {
    pool: pool as unknown as Pool,
    logger: logger as unknown as TimeoutSchedulerOptions["logger"],
    ...(overrides?.schema ? { schema: overrides.schema } : {}),
  };
}

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import type { TimeoutSchedulerOptions } from "./timeout-scheduler.js";
import {
  createPgBossAdapter,
  createTimeoutScheduler,
  parseTimeoutDuration,
  TIMEOUT_QUEUE,
} from "./timeout-scheduler.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createPgBossAdapter", () => {
  it("calls pool.query with text and values, returns { rows, rowCount }", async () => {
    const mockPool = createMockPool();
    const adapter = createPgBossAdapter(mockPool as unknown as Pool);

    const result = await adapter.executeSql("SELECT 1", ["arg1"]);

    expect(mockPool.query).toHaveBeenCalledWith("SELECT 1", ["arg1"]);
    expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it("handles pool.query returning null rowCount (returns 0)", async () => {
    const mockPool = createMockPool();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: null });
    const adapter = createPgBossAdapter(mockPool as unknown as Pool);

    const result = await adapter.executeSql("SELECT 1");

    expect(result).toEqual({ rows: [], rowCount: 0 });
  });

  it("passes through errors from pool.query", async () => {
    const mockPool = createMockPool();
    mockPool.query.mockRejectedValue(new Error("connection refused"));
    const adapter = createPgBossAdapter(mockPool as unknown as Pool);

    await expect(adapter.executeSql("SELECT 1")).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("parseTimeoutDuration", () => {
  it('parses "72h" to 259200000ms', () => {
    expect(parseTimeoutDuration("72h")).toBe(72 * 60 * 60 * 1000);
  });

  it('parses "7d" to 604800000ms', () => {
    expect(parseTimeoutDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses "30m" to 1800000ms', () => {
    expect(parseTimeoutDuration("30m")).toBe(30 * 60 * 1000);
  });

  it('parses "1h" to 3600000ms', () => {
    expect(parseTimeoutDuration("1h")).toBe(60 * 60 * 1000);
  });

  it('throws on invalid format "abc"', () => {
    expect(() => parseTimeoutDuration("abc")).toThrow(
      'Invalid timeout duration: "abc"',
    );
  });

  it("throws on empty string", () => {
    expect(() => parseTimeoutDuration("")).toThrow(
      'Invalid timeout duration: ""',
    );
  });
});

describe("createTimeoutScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("factory", () => {
    it("creates PgBoss with correct options (db adapter, schema, schedule: false, migrate: true)", () => {
      createTimeoutScheduler(
        createSchedulerOptions({ schema: "custom_schema" }),
      );

      expect(MockPgBossClass).toHaveBeenCalledWith(
        expect.objectContaining({
          db: expect.any(Object),
          schema: "custom_schema",
          schedule: false,
          migrate: true,
        }),
      );
    });

    it('uses default schema "pgboss" when not provided', () => {
      createTimeoutScheduler(createSchedulerOptions());

      expect(MockPgBossClass).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: "pgboss",
        }),
      );
    });
  });

  describe("start()", () => {
    it("calls boss.start() and registers worker on TIMEOUT_QUEUE", async () => {
      const mockExecutor = createMockExecutor();
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await scheduler.start(mockExecutor);

      expect(mockBoss.start).toHaveBeenCalled();
      expect(mockBoss.work).toHaveBeenCalledWith(
        TIMEOUT_QUEUE,
        expect.any(Function),
      );
    });

    it("worker handler builds correct Signal and calls executor.signal()", async () => {
      const mockExecutor = createMockExecutor();
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await scheduler.start(mockExecutor);

      // Extract the handler registered with boss.work
      const handler = mockBoss.work.mock.calls[0]?.[1] as (
        jobs: unknown[],
      ) => Promise<void>;

      // Simulate a timeout job firing
      await handler([
        {
          id: "job-456",
          name: TIMEOUT_QUEUE,
          data: {
            conversationId: "conv-abc",
            waitType: "approval",
            reason: "Waiting for human approval",
          },
        },
      ]);

      expect(mockExecutor.signal).toHaveBeenCalledWith("conv-abc", {
        type: "approval",
        data: {
          timeout: true,
          reason: "Waiting for human approval",
        },
        message:
          "Wait timeout: you have been paused waiting for 'approval'. No signal was received. Decide whether to escalate, retry, or complete.",
        source: "internal:scheduler",
        deduplicationId: "timeout-conv-abc-job-456",
      } satisfies Signal);
    });

    it("worker handler logs info when signal is rejected (does NOT throw)", async () => {
      const mockLogger = createMockLogger();
      const mockExecutor = createMockExecutor();
      (mockExecutor.signal as Mock).mockResolvedValue({ action: "rejected" });

      const scheduler = createTimeoutScheduler(
        createSchedulerOptions({ logger: mockLogger }),
      );

      await scheduler.start(mockExecutor);

      const handler = mockBoss.work.mock.calls[0]?.[1] as (
        jobs: unknown[],
      ) => Promise<void>;

      // Should NOT throw even though signal is rejected
      await expect(
        handler([
          {
            id: "job-789",
            name: TIMEOUT_QUEUE,
            data: {
              conversationId: "conv-def",
              waitType: "pr_review",
              reason: "Waiting for review",
            },
          },
        ]),
      ).resolves.not.toThrow();

      // Verify logger.info called with rejection context
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-def",
          jobId: "job-789",
        }),
        expect.stringContaining("rejected"),
      );
    });
  });

  describe("schedule()", () => {
    it("calls boss.send with correct queue, data, and startAfter option", async () => {
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      // Fix Date.now for deterministic testing
      const now = new Date("2026-02-02T12:00:00Z").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const jobId = await scheduler.schedule(
        "conv-123",
        "72h",
        "approval",
        "Waiting for approval",
      );

      expect(mockBoss.send).toHaveBeenCalledWith(
        TIMEOUT_QUEUE,
        {
          conversationId: "conv-123",
          waitType: "approval",
          reason: "Waiting for approval",
        },
        expect.objectContaining({
          startAfter: new Date(now + 72 * 60 * 60 * 1000),
          singletonKey: "conv-123",
        }),
      );

      expect(jobId).toBe("job-id-123");

      vi.restoreAllMocks();
    });

    it("uses singletonKey: conversationId for dedup", async () => {
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await scheduler.schedule("conv-dedup", "1h", "test", "Testing dedup");

      const sendOptions = mockBoss.send.mock.calls[0]?.[2] as {
        singletonKey: string;
      };
      expect(sendOptions.singletonKey).toBe("conv-dedup");
    });

    it("throws if boss.send returns null (scheduling failed)", async () => {
      mockBoss.send.mockResolvedValueOnce(null);
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await expect(
        scheduler.schedule("conv-fail", "1h", "test", "Testing failure"),
      ).rejects.toThrow(
        "Failed to schedule timeout for conversation conv-fail",
      );
    });
  });

  describe("cancel()", () => {
    it("calls boss.cancel with queue name and job ID", async () => {
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await scheduler.cancel("job-to-cancel");

      expect(mockBoss.cancel).toHaveBeenCalledWith(
        TIMEOUT_QUEUE,
        "job-to-cancel",
      );
    });

    it("swallows error when cancel fails (logs debug, does not throw)", async () => {
      const mockLogger = createMockLogger();
      mockBoss.cancel.mockRejectedValueOnce(new Error("job not found"));

      const scheduler = createTimeoutScheduler(
        createSchedulerOptions({ logger: mockLogger }),
      );

      // Should NOT throw
      await expect(scheduler.cancel("missing-job")).resolves.not.toThrow();

      // Verify debug log was called
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "missing-job",
          err: expect.any(Error),
        }),
        expect.stringContaining("cancel failed"),
      );
    });
  });

  describe("close()", () => {
    it("calls boss.stop()", async () => {
      const scheduler = createTimeoutScheduler(createSchedulerOptions());

      await scheduler.close();

      expect(mockBoss.stop).toHaveBeenCalled();
    });
  });
});
