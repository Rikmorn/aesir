import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import {
  buildScheduleQueueName,
  createScheduleRegistry,
} from "./schedule-registry.js";
import type { AgentDefinition, AgentRegistry } from "./types.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: Mock logger matches PinoLogger shape
  } as unknown as any;
}

function createMockPool(queryResults: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockImplementation((sql: string, _params?: unknown[]) => {
      // Return configured results based on SQL pattern
      for (const [pattern, result] of Object.entries(queryResults)) {
        if (sql.includes(pattern)) {
          return Promise.resolve(result);
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    // biome-ignore lint/suspicious/noExplicitAny: Mock pool for testing
  } as unknown as any;
}

function createMockBoss() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    unschedule: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue("worker-id"),
    getSchedules: vi.fn().mockResolvedValue([]),
    // biome-ignore lint/suspicious/noExplicitAny: Mock PgBoss for testing
  } as unknown as any;
}

function createMockAgentRegistry(
  definitions: Partial<AgentDefinition>[] = [],
): AgentRegistry {
  return {
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue(definitions),
  };
}

function makeAgentDef(
  overrides: Partial<AgentDefinition> = {},
): Partial<AgentDefinition> {
  return {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    version: "1.0",
    model: "claude-sonnet-4-20250514",
    tools: ["codebase:read_file"],
    maxIterations: 10,
    tokenBudget: 100000,
    history: {
      pruneThreshold: 80000,
      protectedMessages: 4,
      summaryThreshold: 60000,
      summaryModel: "claude-haiku",
    },
    systemPrompt: "You are a test agent.",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildScheduleQueueName", () => {
  it("builds correct queue name with prefix", () => {
    expect(buildScheduleQueueName("product-agent", "weekly-grooming")).toBe(
      "schedule:product-agent:weekly-grooming",
    );
  });
});

describe("createScheduleRegistry", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockBoss: ReturnType<typeof createMockBoss>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockPool = createMockPool();
    mockBoss = createMockBoss();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerAll", () => {
    it("registers schedules with boss.createQueue, boss.schedule, boss.work", async () => {
      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [
            { name: "weekly-grooming", cron: "0 9 * * MON" },
            {
              name: "daily-standup",
              cron: "0 9 * * *",
              timezone: "America/New_York",
            },
          ],
        }),
      ]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool: mockPool,
        logger: mockLogger,
      });

      await registry.registerAll(mockBoss);

      // Should call createQueue for each schedule
      expect(mockBoss.createQueue).toHaveBeenCalledTimes(2);
      expect(mockBoss.createQueue).toHaveBeenCalledWith(
        "schedule:product-agent:weekly-grooming",
      );
      expect(mockBoss.createQueue).toHaveBeenCalledWith(
        "schedule:product-agent:daily-standup",
      );

      // Should call schedule for each
      expect(mockBoss.schedule).toHaveBeenCalledTimes(2);
      expect(mockBoss.schedule).toHaveBeenCalledWith(
        "schedule:product-agent:weekly-grooming",
        "0 9 * * MON",
        {
          agentId: "product-agent",
          scheduleName: "weekly-grooming",
          cron: "0 9 * * MON",
        },
        { tz: "UTC" },
      );
      expect(mockBoss.schedule).toHaveBeenCalledWith(
        "schedule:product-agent:daily-standup",
        "0 9 * * *",
        {
          agentId: "product-agent",
          scheduleName: "daily-standup",
          cron: "0 9 * * *",
        },
        { tz: "America/New_York" },
      );

      // Should register workers
      expect(mockBoss.work).toHaveBeenCalledTimes(2);
    });

    it("unschedules pg-boss entries that are not in definitions (reconciliation)", async () => {
      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly-grooming", cron: "0 9 * * MON" }],
        }),
      ]);

      mockBoss.getSchedules.mockResolvedValue([
        { name: "schedule:product-agent:weekly-grooming", cron: "0 9 * * MON" },
        { name: "schedule:product-agent:old-schedule", cron: "0 0 * * *" },
        { name: "schedule:removed-agent:daily", cron: "0 6 * * *" },
      ]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool: mockPool,
        logger: mockLogger,
      });

      await registry.registerAll(mockBoss);

      // Should unschedule the two stale schedule: entries
      expect(mockBoss.unschedule).toHaveBeenCalledTimes(2);
      expect(mockBoss.unschedule).toHaveBeenCalledWith(
        "schedule:product-agent:old-schedule",
      );
      expect(mockBoss.unschedule).toHaveBeenCalledWith(
        "schedule:removed-agent:daily",
      );
    });

    it("does NOT unschedule non-schedule queues", async () => {
      const agentRegistry = createMockAgentRegistry([]);

      mockBoss.getSchedules.mockResolvedValue([
        { name: "webhook-dedup-cleanup", cron: "0 * * * *" },
        { name: "conversation-timeout", cron: "" },
      ]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool: mockPool,
        logger: mockLogger,
      });

      await registry.registerAll(mockBoss);

      // Should NOT unschedule non-schedule: prefixed queues
      expect(mockBoss.unschedule).not.toHaveBeenCalled();
    });

    it("handles agents without schedules gracefully", async () => {
      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({ id: "dev-agent" }),
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly", cron: "0 9 * * MON" }],
        }),
      ]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool: mockPool,
        logger: mockLogger,
      });

      await registry.registerAll(mockBoss);

      // Only product-agent has schedules
      expect(mockBoss.createQueue).toHaveBeenCalledTimes(1);
      expect(mockBoss.schedule).toHaveBeenCalledTimes(1);
    });
  });

  describe("overlap detection", () => {
    it("skips when active conversation found", async () => {
      // Set up pool to return an active conversation for overlap check
      const pool = createMockPool({
        "SELECT id, status FROM agents.conversations": {
          rows: [
            {
              id: "product-agent-product-agent:weekly-grooming",
              status: "running",
            },
          ],
        },
      });

      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly-grooming", cron: "0 9 * * MON" }],
        }),
      ]);

      const eventHandler = vi.fn();

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });
      registry.setEventHandler(eventHandler);

      // Capture the worker handler from boss.work
      let workerHandler: (() => Promise<void>) | undefined;
      mockBoss.work.mockImplementation(
        (_name: string, handler: () => Promise<void>) => {
          workerHandler = handler;
          return Promise.resolve("worker-id");
        },
      );

      await registry.registerAll(mockBoss);

      // Fire the worker handler (simulates cron fire)
      await workerHandler?.();

      // Should NOT have called the event handler (skipped)
      expect(eventHandler).not.toHaveBeenCalled();

      // Should have logged the skip
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "product-agent",
          scheduleName: "weekly-grooming",
          activeConversationId: "product-agent-product-agent:weekly-grooming",
        }),
        expect.stringContaining("skipped"),
      );
    });

    it("proceeds when no active conversation found", async () => {
      const pool = createMockPool();
      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly-grooming", cron: "0 9 * * MON" }],
        }),
      ]);

      const eventHandler = vi.fn().mockResolvedValue(undefined);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });
      registry.setEventHandler(eventHandler);

      let workerHandler: (() => Promise<void>) | undefined;
      mockBoss.work.mockImplementation(
        (_name: string, handler: () => Promise<void>) => {
          workerHandler = handler;
          return Promise.resolve("worker-id");
        },
      );

      await registry.registerAll(mockBoss);
      await workerHandler?.();

      // Should have called the event handler with synthetic event
      expect(eventHandler).toHaveBeenCalledTimes(1);
      const event = eventHandler.mock.calls[0]?.[0] as IncomingEvent;
      expect(event.type).toBe("schedule.triggered");
      expect(event.source).toBe("scheduler");
      expect(event.correlationKey).toBe("product-agent:weekly-grooming");
      expect(event.data).toEqual({
        agentId: "product-agent",
        scheduleName: "weekly-grooming",
        cron: "0 9 * * MON",
        trigger: "scheduled",
      });
    });

    it("includes schedule context in synthetic event message (cron path)", async () => {
      const pool = createMockPool({
        "FROM agents.schedule_state": {
          rows: [
            {
              last_run_at: new Date("2026-02-21T09:00:00Z"),
              last_run_outcome: "completed",
              last_run_conversation_id: "conv-prev",
              last_run_summary: "Groomed 8 issues.",
              run_count: 4,
            },
          ],
        },
      });

      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly-grooming", cron: "0 9 * * MON" }],
        }),
      ]);

      const eventHandler = vi.fn().mockResolvedValue(undefined);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });
      registry.setEventHandler(eventHandler);

      let workerHandler: (() => Promise<void>) | undefined;
      mockBoss.work.mockImplementation(
        (_name: string, handler: () => Promise<void>) => {
          workerHandler = handler;
          return Promise.resolve("worker-id");
        },
      );

      await registry.registerAll(mockBoss);
      await workerHandler?.();

      expect(eventHandler).toHaveBeenCalledTimes(1);
      const event = eventHandler.mock.calls[0]?.[0] as IncomingEvent;
      // Message should include schedule context XML block
      expect(event.message).toContain("<schedule_context>");
      expect(event.message).toContain("Schedule: weekly-grooming");
      expect(event.message).toContain("Trigger: scheduled");
      expect(event.message).toContain("Last run outcome: completed");
      expect(event.message).toContain("Run count: 4");
      expect(event.message).toContain("Scheduled run: weekly-grooming");
    });
  });

  describe("buildScheduleContext", () => {
    it("returns valid XML block with all fields for existing state", async () => {
      const lastRunAt = new Date("2026-02-21T09:00:00Z");
      const pool = createMockPool({
        "FROM agents.schedule_state": {
          rows: [
            {
              last_run_at: lastRunAt,
              last_run_outcome: "completed",
              last_run_conversation_id: "conv-123",
              last_run_summary: "Processed 12 items successfully.",
              run_count: 15,
            },
          ],
        },
      });

      const agentRegistry = createMockAgentRegistry([]);
      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });

      const context = await registry.buildScheduleContext(
        "product-agent",
        "weekly-grooming",
        "scheduled",
      );

      expect(context).toContain("<schedule_context>");
      expect(context).toContain("</schedule_context>");
      expect(context).toContain("Schedule: weekly-grooming");
      expect(context).toContain("Last run: 2026-02-21T09:00:00.000Z");
      expect(context).toContain("Last run outcome: completed");
      expect(context).toContain(
        "Last run summary: Processed 12 items successfully.",
      );
      expect(context).toContain("Run count: 15");
      expect(context).toContain("Trigger: scheduled");
    });

    it("handles first run (no previous state)", async () => {
      const pool = createMockPool();
      const agentRegistry = createMockAgentRegistry([]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });

      const context = await registry.buildScheduleContext(
        "product-agent",
        "weekly-grooming",
        "manual",
      );

      expect(context).toContain("<schedule_context>");
      expect(context).toContain("Last run: Never");
      expect(context).toContain("Time since last run: First run");
      expect(context).toContain("Last run outcome: N/A");
      expect(context).toContain("Last run summary: No previous run");
      expect(context).toContain("Run count: 0");
      expect(context).toContain("Trigger: manual");
    });
  });

  describe("updateScheduleState", () => {
    it("calls upsert with correct parameters", async () => {
      const pool = createMockPool();
      const agentRegistry = createMockAgentRegistry([]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });

      await registry.updateScheduleState(
        "product-agent",
        "weekly-grooming",
        "completed",
        "conv-abc",
        "Groomed 12 issues.",
      );

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO agents.schedule_state"),
        [
          "product-agent",
          "weekly-grooming",
          "completed",
          "conv-abc",
          "Groomed 12 issues.",
        ],
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT"),
        expect.any(Array),
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "run_count = agents.schedule_state.run_count + 1",
        ),
        expect.any(Array),
      );
    });
  });

  describe("getScheduleStates", () => {
    it("returns mapped schedule states for an agent", async () => {
      const pool = createMockPool({
        "WHERE agent_id": {
          rows: [
            {
              agent_id: "product-agent",
              schedule_name: "weekly-grooming",
              last_run_at: new Date("2026-02-21T09:00:00Z").toISOString(),
              last_run_outcome: "completed",
              last_run_conversation_id: "conv-123",
              last_run_summary: "Done.",
              run_count: 5,
            },
          ],
        },
      });

      const agentRegistry = createMockAgentRegistry([]);
      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });

      const states = await registry.getScheduleStates("product-agent");
      expect(states).toHaveLength(1);
      expect(states[0]?.agentId).toBe("product-agent");
      expect(states[0]?.scheduleName).toBe("weekly-grooming");
      expect(states[0]?.lastRunOutcome).toBe("completed");
      expect(states[0]?.runCount).toBe(5);
    });
  });

  describe("setEventHandler", () => {
    it("logs error when no event handler is set and schedule fires", async () => {
      const pool = createMockPool(); // No active conversations
      const agentRegistry = createMockAgentRegistry([
        makeAgentDef({
          id: "product-agent",
          schedules: [{ name: "weekly", cron: "0 9 * * MON" }],
        }),
      ]);

      const registry = createScheduleRegistry({
        agentRegistry,
        pool,
        logger: mockLogger,
      });
      // Deliberately NOT calling setEventHandler

      let workerHandler: (() => Promise<void>) | undefined;
      mockBoss.work.mockImplementation(
        (_name: string, handler: () => Promise<void>) => {
          workerHandler = handler;
          return Promise.resolve("worker-id");
        },
      );

      await registry.registerAll(mockBoss);
      await workerHandler?.();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "product-agent" }),
        expect.stringContaining("no event handler"),
      );
    });
  });
});
