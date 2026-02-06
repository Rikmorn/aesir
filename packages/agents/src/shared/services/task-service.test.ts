/**
 * TaskService Unit Tests
 *
 * Tests Zod validation and service behavior using mocked database.
 * Covers: create, update, addHandoff, getLatestHandoff validation rules.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock createId to generate deterministic IDs
vi.mock("@aesir/types", () => ({
  createId: {
    task: vi.fn().mockReturnValue("task_test123"),
    handoff: vi.fn().mockReturnValue("ho_test456"),
  },
}));

import { createId } from "@aesir/types";
import { createTaskService, type TaskService } from "./task-service.js";

// ─── Mock Helpers ───────────────────────────────────────────────────────────

function createMockDb() {
  // Chainable mock for SELECT: db.select().from().where().orderBy().limit()
  const limitFn = vi.fn().mockResolvedValue([]);
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const whereFn = vi
    .fn()
    .mockReturnValue({ limit: limitFn, orderBy: orderByFn });
  const fromFn = vi
    .fn()
    .mockReturnValue({ where: whereFn, orderBy: orderByFn, limit: limitFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  // Chainable mock for INSERT: db.insert().values().returning()
  const insertReturningFn = vi.fn().mockResolvedValue([]);
  const insertValuesFn = vi
    .fn()
    .mockReturnValue({ returning: insertReturningFn });
  const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

  // Chainable mock for UPDATE: db.update().set().where().returning()
  const updateReturningFn = vi.fn().mockResolvedValue([]);
  const updateWhereFn = vi
    .fn()
    .mockReturnValue({ returning: updateReturningFn });
  const updateSetFn = vi.fn().mockReturnValue({ where: updateWhereFn });
  const updateFn = vi.fn().mockReturnValue({ set: updateSetFn });

  // Execute mock for health check
  const executeFn = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });

  return {
    db: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
      execute: executeFn,
    },
    mocks: {
      select: selectFn,
      from: fromFn,
      where: whereFn,
      orderBy: orderByFn,
      limit: limitFn,
      insert: insertFn,
      insertValues: insertValuesFn,
      insertReturning: insertReturningFn,
      update: updateFn,
      updateSet: updateSetFn,
      updateWhere: updateWhereFn,
      updateReturning: updateReturningFn,
      execute: executeFn,
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

// ─── Valid Test Data ────────────────────────────────────────────────────────

const validCreateParams = {
  creatorType: "agent" as const,
  creatorId: "dev-agent",
  assigneeType: "agent" as const,
  assigneeId: "dev-agent",
  title: "Implement authentication",
  objective: "Add JWT-based auth to the API",
};

const validHandoffParams = {
  taskId: "task_abc123",
  conversationId: "conv_xyz789",
  handoffType: "completion" as const,
  context: {
    summary: "Completed JWT implementation with refresh token rotation",
  },
  authorType: "agent" as const,
  authorId: "dev-agent",
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TaskService", () => {
  let service: TaskService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    service = createTaskService({
      // biome-ignore lint/suspicious/noExplicitAny: mock db for unit testing
      db: mockDb.db as any,
      // biome-ignore lint/suspicious/noExplicitAny: mock logger for unit testing
      logger: mockLogger as any,
    });
  });

  // ─── Factory Validation ─────────────────────────────────────────────

  describe("factory", () => {
    it("throws if db is missing", () => {
      expect(() =>
        createTaskService({
          // biome-ignore lint/suspicious/noExplicitAny: testing missing param
          db: null as any,
          // biome-ignore lint/suspicious/noExplicitAny: mock logger
          logger: mockLogger as any,
        }),
      ).toThrow("db is required for TaskService");
    });

    it("throws if logger is missing", () => {
      expect(() =>
        createTaskService({
          // biome-ignore lint/suspicious/noExplicitAny: mock db
          db: mockDb.db as any,
          // biome-ignore lint/suspicious/noExplicitAny: testing missing param
          logger: null as any,
        }),
      ).toThrow("logger is required for TaskService");
    });
  });

  // ─── create() ───────────────────────────────────────────────────────

  describe("create()", () => {
    it("rejects empty title", async () => {
      await expect(
        service.create({ ...validCreateParams, title: "" }),
      ).rejects.toThrow();
    });

    it("rejects invalid creator_type", async () => {
      await expect(
        service.create({
          ...validCreateParams,
          // biome-ignore lint/suspicious/noExplicitAny: testing invalid enum
          creatorType: "robot" as any,
        }),
      ).rejects.toThrow();
    });

    it("rejects metadata over 10KB", async () => {
      const bigMetadata = { data: "x".repeat(11000) };
      await expect(
        service.create({ ...validCreateParams, metadata: bigMetadata }),
      ).rejects.toThrow("Task metadata must be under 10KB");
    });

    it("calls createId.task() and inserts with correct values", async () => {
      const mockTask = {
        id: "task_test123",
        title: "Implement authentication",
        status: "active",
      };
      mockDb.mocks.insertReturning.mockResolvedValue([mockTask]);

      const result = await service.create(validCreateParams);

      expect(createId.task).toHaveBeenCalled();
      expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task_test123",
          creator_type: "agent",
          creator_id: "dev-agent",
          assignee_type: "agent",
          assignee_id: "dev-agent",
          title: "Implement authentication",
          status: "active",
        }),
      );
      expect(result).toEqual(mockTask);
    });

    it("defaults status to active", async () => {
      const mockTask = { id: "task_test123", status: "active" };
      mockDb.mocks.insertReturning.mockResolvedValue([mockTask]);

      await service.create(validCreateParams);

      expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" }),
      );
    });

    it("accepts valid params with all optional fields", async () => {
      const mockTask = { id: "task_test123" };
      mockDb.mocks.insertReturning.mockResolvedValue([mockTask]);

      const result = await service.create({
        ...validCreateParams,
        parentId: "task_parent123",
        objective: "Full objective text",
        metadata: { priority: "high" },
      });

      expect(result).toEqual(mockTask);
    });
  });

  // ─── update() ──────────────────────────────────────────────────────

  describe("update()", () => {
    it("rejects empty update object", async () => {
      await expect(service.update("task_123", {})).rejects.toThrow(
        "At least one field must be provided for update",
      );
    });

    it("sets updated_at on every update", async () => {
      const mockTask = { id: "task_123", status: "active" };
      mockDb.mocks.updateReturning.mockResolvedValue([mockTask]);

      await service.update("task_123", { title: "New title" });

      expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_at: expect.any(Date),
          title: "New title",
        }),
      );
    });

    it("sets completed_at when status becomes completed", async () => {
      const mockTask = { id: "task_123", status: "completed" };
      mockDb.mocks.updateReturning.mockResolvedValue([mockTask]);

      await service.update("task_123", { status: "completed" });

      expect(mockDb.mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "completed",
          completed_at: expect.any(Date),
          updated_at: expect.any(Date),
        }),
      );
    });

    it("does NOT set completed_at for non-completed status", async () => {
      const mockTask = { id: "task_123", status: "paused" };
      mockDb.mocks.updateReturning.mockResolvedValue([mockTask]);

      await service.update("task_123", { status: "paused" });

      const setArgs = mockDb.mocks.updateSet.mock.calls[0]?.[0];
      expect(setArgs).not.toHaveProperty("completed_at");
      expect(setArgs).toHaveProperty("status", "paused");
    });

    it("throws 'Task not found' when no rows returned", async () => {
      mockDb.mocks.updateReturning.mockResolvedValue([]);

      await expect(
        service.update("task_nonexistent", { title: "New title" }),
      ).rejects.toThrow("Task not found: task_nonexistent");
    });
  });

  // ─── addHandoff() ──────────────────────────────────────────────────

  describe("addHandoff()", () => {
    it("rejects missing summary (empty string)", async () => {
      await expect(
        service.addHandoff({
          ...validHandoffParams,
          context: { summary: "" },
        }),
      ).rejects.toThrow();
    });

    it("rejects summary over 2000 characters", async () => {
      await expect(
        service.addHandoff({
          ...validHandoffParams,
          context: { summary: "x".repeat(2001) },
        }),
      ).rejects.toThrow();
    });

    it("rejects context over 4KB total", async () => {
      await expect(
        service.addHandoff({
          ...validHandoffParams,
          context: {
            summary: "Short summary",
            key_decisions: ["a".repeat(2000), "b".repeat(2100)],
          },
        }),
      ).rejects.toThrow("Handoff context must be under 4KB");
    });

    it("accepts valid handoff with all optional fields", async () => {
      const mockHandoff = { id: "ho_test456" };
      mockDb.mocks.insertReturning.mockResolvedValue([mockHandoff]);

      const result = await service.addHandoff({
        ...validHandoffParams,
        context: {
          summary: "Completed the work",
          key_decisions: ["Used JWT", "Added refresh tokens"],
          artifacts: { pr_url: "https://github.com/org/repo/pull/42" },
          open_questions: ["Should we add rate limiting?"],
          next_steps: "Deploy to staging",
        },
      });

      expect(createId.handoff).toHaveBeenCalled();
      expect(result).toEqual(mockHandoff);
    });

    it("accepts minimal handoff (summary only)", async () => {
      const mockHandoff = { id: "ho_test456" };
      mockDb.mocks.insertReturning.mockResolvedValue([mockHandoff]);

      const result = await service.addHandoff(validHandoffParams);

      expect(result).toEqual(mockHandoff);
      expect(mockDb.mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ho_test456",
          task_id: "task_abc123",
          conversation_id: "conv_xyz789",
          handoff_type: "completion",
          author_type: "agent",
          author_id: "dev-agent",
        }),
      );
    });
  });

  // ─── getLatestHandoff() ────────────────────────────────────────────

  describe("getLatestHandoff()", () => {
    it("returns null when no handoffs exist", async () => {
      mockDb.mocks.limit.mockResolvedValue([]);

      const result = await service.getLatestHandoff("task_empty");

      expect(result).toBeNull();
    });

    it("returns the most recent handoff", async () => {
      const mockHandoff = {
        id: "ho_latest",
        task_id: "task_123",
        created_at: new Date("2026-02-06"),
      };
      mockDb.mocks.limit.mockResolvedValue([mockHandoff]);

      const result = await service.getLatestHandoff("task_123");

      expect(result).toEqual(mockHandoff);
    });
  });

  // ─── health() ──────────────────────────────────────────────────────

  describe("health()", () => {
    it("returns healthy with latency when db responds", async () => {
      const result = await service.health();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy when db fails", async () => {
      mockDb.mocks.execute.mockRejectedValue(new Error("Connection refused"));

      const result = await service.health();
      expect(result.healthy).toBe(false);
    });
  });
});
