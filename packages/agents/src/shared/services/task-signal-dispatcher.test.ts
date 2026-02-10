/**
 * TaskSignalDispatcher Tests
 *
 * Tests for createTaskSignalDispatcher.onTaskUpdate covering:
 * terminal vs non-terminal status, root task no-op, completion signal dispatch,
 * failure signal dispatch, orphan path, delivery path, failed delivery,
 * and non-fatal error handling.
 */

import { describe, expect, it, vi } from "vitest";
import { createTaskSignalDispatcher } from "./task-signal-dispatcher.js";

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockExecutor() {
  return {
    start: vi.fn(),
    signal: vi.fn().mockResolvedValue({ action: "resumed" as const }),
    get: vi.fn(),
    cancel: vi.fn(),
    reopen: vi.fn(),
    list: vi.fn(),
    startWorker: vi.fn(),
    stopWorker: vi.fn(),
    getWorkerStatus: vi.fn(),
    findActiveForTask: vi.fn().mockResolvedValue(null),
  };
}

function createMockTaskService() {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    addHandoff: vi.fn(),
    transitionWithHandoff: vi.fn(),
    getHandoffs: vi.fn(),
    getLatestHandoff: vi.fn(),
    listByAssignee: vi.fn(),
    listByParent: vi.fn(),
    linkConversation: vi.fn(),
    setDispatcher: vi.fn(),
    health: vi.fn(),
    close: vi.fn(),
  };
}

function createMockEventLog() {
  return {
    append: vi.fn(),
    query: vi.fn(),
    subscribe: vi.fn(),
    initSequence: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

function createMockDb() {
  const chainable = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    update: vi.fn().mockReturnValue(chainable),
    chain_ref: chainable,
  };
}

function createMockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}

function createMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_child1",
    parent_id: "task_parent1",
    creator_type: "agent" as const,
    creator_id: "dev-agent",
    assignee_type: "agent" as const,
    assignee_id: "dev-agent",
    status: "completed",
    title: "Implement feature X",
    objective: "Build the feature as specified",
    metadata: {},
    completion_result: null,
    delegation_depth: 1,
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createTaskSignalDispatcher", () => {
  describe("onTaskUpdate", () => {
    it("is a no-op for non-terminal status", async () => {
      const executor = createMockExecutor();
      const taskService = createMockTaskService();
      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_1", "created", "active");

      // Should not fetch task or signal
      expect(taskService.get).not.toHaveBeenCalled();
      expect(executor.signal).not.toHaveBeenCalled();
    });

    it("is a no-op when task not found", async () => {
      const executor = createMockExecutor();
      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(null);
      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_1", "active", "completed");

      expect(taskService.get).toHaveBeenCalledWith("task_1");
      expect(executor.signal).not.toHaveBeenCalled();
    });

    it("is a no-op when task has no parent_id (root task)", async () => {
      const executor = createMockExecutor();
      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask({ parent_id: null }));
      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_1", "active", "completed");

      expect(taskService.get).toHaveBeenCalledWith("task_1");
      expect(executor.findActiveForTask).not.toHaveBeenCalled();
      expect(executor.signal).not.toHaveBeenCalled();
    });

    it("dispatches task_completion signal when status becomes completed", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue({
        id: "conv_parent",
        status: "waiting",
      });
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask());

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "completed");

      expect(executor.findActiveForTask).toHaveBeenCalledWith("task_parent1");
      expect(executor.signal).toHaveBeenCalledWith(
        "conv_parent",
        expect.objectContaining({
          type: "task_completion",
          data: expect.objectContaining({ taskId: "task_child1" }),
        }),
      );
    });

    it("dispatches task_failure signal when status becomes failed", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue({
        id: "conv_parent",
        status: "waiting",
      });
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask());

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "failed");

      expect(executor.signal).toHaveBeenCalledWith(
        "conv_parent",
        expect.objectContaining({
          type: "task_failure",
        }),
      );
    });

    it("orphan path: writes completion_result with status orphaned when no active conversation found", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue(null);

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask());

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "completed");

      // Should write completion_result with orphaned status
      expect(db.update).toHaveBeenCalled();
      expect(db.chain_ref.set).toHaveBeenCalledWith(
        expect.objectContaining({
          completion_result: expect.objectContaining({
            deliveryStatus: "orphaned",
            signalType: "task_completion",
          }),
        }),
      );

      // Should NOT call executor.signal (no target conversation)
      expect(executor.signal).not.toHaveBeenCalled();

      // Should log orphan event
      expect(eventLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "signal.orphaned",
          payload: expect.objectContaining({
            taskId: "task_child1",
            signalType: "task_completion",
          }),
        }),
      );
    });

    it("delivery path: writes completion_result with status delivered after successful signal delivery", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue({
        id: "conv_parent",
        status: "waiting",
      });
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask());

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "completed");

      // Should write completion_result with delivered status
      expect(db.chain_ref.set).toHaveBeenCalledWith(
        expect.objectContaining({
          completion_result: expect.objectContaining({
            deliveryStatus: "delivered",
            targetConversationId: "conv_parent",
          }),
        }),
      );
    });

    it("failed delivery: writes completion_result with status failed when signal is rejected", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue({
        id: "conv_parent",
        status: "completed",
      });
      executor.signal.mockResolvedValue({ action: "rejected" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(createMockTask());

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "completed");

      expect(db.chain_ref.set).toHaveBeenCalledWith(
        expect.objectContaining({
          completion_result: expect.objectContaining({
            deliveryStatus: "failed",
            targetConversationId: "conv_parent",
          }),
        }),
      );
    });

    it("dispatch errors are caught and logged (non-fatal)", async () => {
      const executor = createMockExecutor();
      const taskService = createMockTaskService();
      // Simulate internal error during get
      taskService.get.mockRejectedValue(new Error("DB connection lost"));

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
      });

      // Should NOT throw
      await expect(
        dispatcher.onTaskUpdate("task_child1", "active", "completed"),
      ).resolves.toBeUndefined();

      // Should log the error
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("non-fatal"),
      );
    });
  });
});
