/**
 * TaskSignalDispatcher Tests
 *
 * Tests for createTaskSignalDispatcher.onTaskUpdate covering:
 * - Per-task signaling: terminal vs non-terminal status, root task no-op,
 *   completion/failure signal dispatch, orphan path, delivery path, failed delivery,
 *   non-fatal error handling
 * - Group-aware signaling (Phase 81): all_required, any_sufficient, min_required
 *   policy evaluation, settled transitions, concurrent evaluation idempotency,
 *   regression for non-group tasks
 */

import { describe, expect, it, vi } from "vitest";
import type { GroupService, GroupState } from "./group-service.js";
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
    getSequence: vi.fn().mockReturnValue(0),
  };
}

function createMockDb() {
  const chainable = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    update: vi.fn().mockReturnValue(chainable),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
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
    group_id: null,
    ...overrides,
  };
}

function createMockGroupService(overrides: Partial<GroupService> = {}): GroupService {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    getGroupState: vi.fn().mockResolvedValue({
      groupId: "grp_test1",
      policy: { type: "all_required" },
      status: "active",
      total: 3,
      completed: 0,
      failed: 0,
      cancelled: 0,
      running: 3,
      pending: 0,
      tasks: [],
      timeoutJobId: null,
    } satisfies GroupState),
    updateStatus: vi.fn(),
    setTimeoutJobId: vi.fn(),
    ...overrides,
  };
}

/**
 * Helper to create a group state with specific counts.
 * All tasks in the state have status derived from the counts.
 */
function buildGroupState(
  groupId: string,
  policy: { type: string; threshold?: number },
  status: string,
  counts: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    pending: number;
  },
): GroupState {
  const tasks: GroupState["tasks"] = [];

  for (let i = 0; i < counts.completed; i++) {
    tasks.push({
      taskId: `task_${groupId}_completed_${i}`,
      status: "completed",
      assigneeId: `agent_${i}`,
      title: `Task ${i}`,
      completionResult: { summary: `Completed task ${i}` },
    });
  }
  for (let i = 0; i < counts.failed; i++) {
    tasks.push({
      taskId: `task_${groupId}_failed_${i}`,
      status: "cancelled", // DB has no 'failed' -- cancelled is the terminal non-success
      assigneeId: `agent_${counts.completed + i}`,
      title: `Task ${counts.completed + i}`,
      completionResult: null,
    });
  }
  for (let i = 0; i < counts.cancelled; i++) {
    tasks.push({
      taskId: `task_${groupId}_cancelled_${i}`,
      status: "cancelled",
      assigneeId: `agent_${counts.completed + counts.failed + i}`,
      title: `Task ${counts.completed + counts.failed + i}`,
      completionResult: null,
    });
  }
  for (let i = 0; i < counts.running; i++) {
    tasks.push({
      taskId: `task_${groupId}_running_${i}`,
      status: "active",
      assigneeId: `agent_${counts.completed + counts.failed + counts.cancelled + i}`,
      title: `Task ${counts.completed + counts.failed + counts.cancelled + i}`,
      completionResult: null,
    });
  }
  for (let i = 0; i < counts.pending; i++) {
    tasks.push({
      taskId: `task_${groupId}_pending_${i}`,
      status: "created",
      assigneeId: `agent_${counts.completed + counts.failed + counts.cancelled + counts.running + i}`,
      title: `Task ${counts.completed + counts.failed + counts.cancelled + counts.running + i}`,
      completionResult: null,
    });
  }

  return {
    groupId,
    policy,
    status: status as GroupState["status"],
    total: counts.total,
    completed: counts.completed,
    failed: counts.failed,
    cancelled: counts.cancelled,
    running: counts.running,
    pending: counts.pending,
    tasks,
    timeoutJobId: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createTaskSignalDispatcher", () => {
  describe("onTaskUpdate - per-task signaling", () => {
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

    it("task without group_id follows per-task path (regression)", async () => {
      const executor = createMockExecutor();
      executor.findActiveForTask.mockResolvedValue({
        id: "conv_parent",
        status: "waiting",
      });
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(
        createMockTask({ group_id: null }),
      );

      const eventLog = createMockEventLog();
      const db = createMockDb();
      const logger = createMockLogger();
      const groupService = createMockGroupService();

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
        groupService,
      });

      await dispatcher.onTaskUpdate("task_child1", "active", "completed");

      // Should use per-task signaling, not group
      expect(executor.signal).toHaveBeenCalledWith(
        "conv_parent",
        expect.objectContaining({ type: "task_completion" }),
      );
      expect(groupService.getGroupState).not.toHaveBeenCalled();
    });
  });

  describe("onTaskUpdate - group-aware signaling", () => {
    const GROUP_ID = "grp_test1";
    const DELEGATOR_CONV_ID = "conv_delegator";

    function setupGroupTest(opts: {
      policy: { type: string; threshold?: number };
      groupStatus?: string;
      state: GroupState;
      /** If provided, subsequent calls to getGroupState return these states in order */
      subsequentStates?: GroupState[];
    }) {
      const executor = createMockExecutor();
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(
        createMockTask({
          id: "task_triggering",
          group_id: GROUP_ID,
          parent_id: "task_group_parent",
        }),
      );

      const eventLog = createMockEventLog();
      const db = createMockDb();

      // Mock db.execute for SELECT FOR UPDATE
      db.execute.mockResolvedValue({
        rows: [
          {
            id: GROUP_ID,
            delegator_conversation_id: DELEGATOR_CONV_ID,
            policy: opts.policy,
            status: opts.groupStatus ?? "active",
          },
        ],
      });

      const logger = createMockLogger();

      // Setup getGroupState to return the provided state, then subsequent states
      const getGroupStateMock = vi.fn();
      const allStates = [opts.state, ...(opts.subsequentStates ?? [opts.state])];
      for (const s of allStates) {
        getGroupStateMock.mockResolvedValueOnce(s);
      }
      // Final fallback
      getGroupStateMock.mockResolvedValue(
        allStates[allStates.length - 1],
      );

      const groupService = createMockGroupService({
        getGroupState: getGroupStateMock,
      });

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: eventLog as never,
        db: db as never,
        logger: logger as never,
        groupService,
      });

      return { executor, taskService, db, logger, groupService, dispatcher };
    }

    it("all_required: first failure sends group_task_failed signal", async () => {
      const policy = { type: "all_required" };
      // 1 failed out of 3 total, 2 still running
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 0,
        failed: 1,
        cancelled: 0,
        running: 2,
        pending: 0,
      });
      // After status update, re-read still has running tasks
      const settledState = buildGroupState(GROUP_ID, policy, "unsatisfiable", {
        total: 3,
        completed: 0,
        failed: 1,
        cancelled: 0,
        running: 2,
        pending: 0,
      });

      const { executor, groupService } = setupGroupTest({
        policy,
        state,
        subsequentStates: [settledState],
      });

      await executor.signal.mockResolvedValue({ action: "resumed" });

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: createMockTaskService() as never,
        eventLog: createMockEventLog() as never,
        db: (() => {
          const db = createMockDb();
          db.execute.mockResolvedValue({
            rows: [{
              id: GROUP_ID,
              delegator_conversation_id: DELEGATOR_CONV_ID,
              policy,
              status: "active",
            }],
          });
          return db;
        })() as never,
        logger: createMockLogger() as never,
        groupService: (() => {
          const gs = createMockGroupService();
          (gs.getGroupState as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(state)
            .mockResolvedValue(settledState);
          return gs;
        })(),
      });

      // Mock task with group_id
      const ts = createMockTaskService();
      ts.get.mockResolvedValue(
        createMockTask({ id: "task_triggering", group_id: GROUP_ID, parent_id: "task_p" }),
      );

      // Use the setupGroupTest helper instead
      const result = setupGroupTest({
        policy,
        state,
        subsequentStates: [settledState],
      });

      await result.dispatcher.onTaskUpdate("task_triggering", "active", "failed");

      // Should send group_task_failed (not group_policy_unsatisfiable) for all_required
      expect(result.executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_task_failed",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            taskId: "task_triggering",
            policyType: "all_required",
            policyUnsatisfiable: true,
          }),
        }),
      );

      // Should update group status to unsatisfiable
      expect(result.groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "unsatisfiable",
      );
    });

    it("all_required: all complete sends group_policy_satisfied signal", async () => {
      const policy = { type: "all_required" };
      // All 3 completed
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });
      // After satisfied, all terminal => also triggers settled
      const settledState = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [settledState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // Should send group_policy_satisfied
      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_policy_satisfied",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            policyType: "all_required",
            policySatisfied: true,
          }),
        }),
      );

      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "satisfied",
      );
    });

    it("any_sufficient: first complete sends group_policy_satisfied signal", async () => {
      const policy = { type: "any_sufficient" };
      // 1 completed, 2 still running
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });
      const afterState = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_policy_satisfied",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            policyType: "any_sufficient",
            policySatisfied: true,
          }),
        }),
      );

      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "satisfied",
      );
    });

    it("any_sufficient: all fail sends group_policy_unsatisfiable signal", async () => {
      const policy = { type: "any_sufficient" };
      // All 3 failed (cancelled)
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 0,
        failed: 3,
        cancelled: 0,
        running: 0,
        pending: 0,
      });
      const settledState = buildGroupState(GROUP_ID, policy, "unsatisfiable", {
        total: 3,
        completed: 0,
        failed: 3,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [settledState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "failed");

      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_policy_unsatisfiable",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            policyType: "any_sufficient",
            policyUnsatisfiable: true,
          }),
        }),
      );

      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "unsatisfiable",
      );
    });

    it("min_required(2) of 3: 2 complete sends group_policy_satisfied", async () => {
      const policy = { type: "min_required", threshold: 2 };
      // 2 completed, 1 still running
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 2,
        failed: 0,
        cancelled: 0,
        running: 1,
        pending: 0,
      });
      const afterState = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 2,
        failed: 0,
        cancelled: 0,
        running: 1,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_policy_satisfied",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            policyType: "min_required",
            policySatisfied: true,
          }),
        }),
      );

      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "satisfied",
      );
    });

    it("min_required(2) of 3: 2 fail sends group_policy_unsatisfiable (remaining < N)", async () => {
      const policy = { type: "min_required", threshold: 2 };
      // 2 failed, 1 still running -> remaining = 1 < 2
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 0,
        failed: 2,
        cancelled: 0,
        running: 1,
        pending: 0,
      });
      const afterState = buildGroupState(GROUP_ID, policy, "unsatisfiable", {
        total: 3,
        completed: 0,
        failed: 2,
        cancelled: 0,
        running: 1,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "failed");

      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          type: "group_policy_unsatisfiable",
          data: expect.objectContaining({
            groupId: GROUP_ID,
            policyType: "min_required",
            policyUnsatisfiable: true,
          }),
        }),
      );

      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "unsatisfiable",
      );
    });

    it("no signal when policy neither satisfied nor unsatisfiable", async () => {
      const policy = { type: "all_required" };
      // 1 completed, 2 still running -- policy not yet deterministic
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // No signal should be sent
      expect(executor.signal).not.toHaveBeenCalled();
      // No status update
      expect(groupService.updateStatus).not.toHaveBeenCalled();
    });

    it("group in terminal state: no signal sent (idempotent)", async () => {
      const policy = { type: "all_required" };
      // Group already satisfied, all tasks done
      const state = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });
      // Already settled
      const settledState = buildGroupState(GROUP_ID, policy, "settled", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const executor = createMockExecutor();
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(
        createMockTask({
          id: "task_triggering",
          group_id: GROUP_ID,
          parent_id: "task_group_parent",
        }),
      );

      const db = createMockDb();
      db.execute.mockResolvedValue({
        rows: [{
          id: GROUP_ID,
          delegator_conversation_id: DELEGATOR_CONV_ID,
          policy,
          status: "settled", // Already settled
        }],
      });

      const logger = createMockLogger();

      const getGroupStateMock = vi.fn()
        .mockResolvedValueOnce(state)
        .mockResolvedValue(settledState);

      const groupService = createMockGroupService({
        getGroupState: getGroupStateMock,
      });

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: createMockEventLog() as never,
        db: db as never,
        logger: logger as never,
        groupService,
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // No policy evaluation signal (group is already terminal)
      // No settled signal (already settled -- status check prevents duplicate)
      // The settled check only fires if status is NOT 'active' and NOT 'settled',
      // but here it's 'settled' so no transition occurs
      expect(executor.signal).not.toHaveBeenCalled();
      expect(groupService.updateStatus).not.toHaveBeenCalled();
    });

    it("settled transition: all terminal after policy evaluation sends group_settled", async () => {
      const policy = { type: "all_required" };
      // All 3 completed (satisfied + all terminal => should also send settled)
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });
      // After satisfied status update, re-query returns satisfied status
      const afterSatisfied = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const { executor, groupService, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterSatisfied],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // Should get both satisfied AND settled signals
      const signalCalls = executor.signal.mock.calls as Array<
        [string, { type: string }]
      >;
      const signalTypes = signalCalls.map((call) => call[1].type);

      expect(signalTypes).toContain("group_policy_satisfied");
      expect(signalTypes).toContain("group_settled");

      // Should have updated status twice: satisfied, then settled
      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "satisfied",
      );
      expect(groupService.updateStatus).toHaveBeenCalledWith(
        GROUP_ID,
        "settled",
      );
    });

    it("concurrent evaluation: second evaluation after group satisfied sends no duplicate signal", async () => {
      const policy = { type: "all_required" };
      // Group already satisfied from a previous evaluation
      const state = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const executor = createMockExecutor();
      executor.signal.mockResolvedValue({ action: "resumed" });

      const taskService = createMockTaskService();
      taskService.get.mockResolvedValue(
        createMockTask({
          id: "task_triggering",
          group_id: GROUP_ID,
          parent_id: "task_group_parent",
        }),
      );

      const db = createMockDb();
      db.execute.mockResolvedValue({
        rows: [{
          id: GROUP_ID,
          delegator_conversation_id: DELEGATOR_CONV_ID,
          policy,
          status: "satisfied", // Already satisfied
        }],
      });

      const logger = createMockLogger();
      const getGroupStateMock = vi.fn().mockResolvedValue(state);
      const groupService = createMockGroupService({
        getGroupState: getGroupStateMock,
      });

      const dispatcher = createTaskSignalDispatcher({
        executor: executor as never,
        taskService: taskService as never,
        eventLog: createMockEventLog() as never,
        db: db as never,
        logger: logger as never,
        groupService,
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // Group is satisfied but all terminal, so it should transition to settled
      // It should NOT re-send group_policy_satisfied
      const signalCalls = executor.signal.mock.calls as Array<
        [string, { type: string }]
      >;
      const satisfiedSignals = signalCalls.filter(
        (call) => call[1].type === "group_policy_satisfied",
      );
      expect(satisfiedSignals.length).toBe(0);
    });

    it("group signal payload includes groupId for signal matching", async () => {
      const policy = { type: "any_sufficient" };
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });
      const afterState = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });

      const { executor, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // Verify signal data includes groupId (required for groupId-scoped signal matching)
      expect(executor.signal).toHaveBeenCalledWith(
        DELEGATOR_CONV_ID,
        expect.objectContaining({
          data: expect.objectContaining({
            groupId: GROUP_ID,
          }),
        }),
      );
    });

    it("group signal payload includes task summaries for terminal tasks", async () => {
      const policy = { type: "all_required" };
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });
      const afterState = buildGroupState(GROUP_ID, policy, "satisfied", {
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        running: 0,
        pending: 0,
      });

      const { executor, dispatcher } = setupGroupTest({
        policy,
        state,
        subsequentStates: [afterState],
      });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      const signalCalls = executor.signal.mock.calls as Array<
        [string, { type: string; data: Record<string, unknown> }]
      >;
      const signalCall = signalCalls[0]!;
      const signalData = signalCall[1].data;

      expect(signalData.taskSummaries).toBeDefined();
      expect(Array.isArray(signalData.taskSummaries)).toBe(true);
      expect((signalData.taskSummaries as unknown[]).length).toBe(3); // All 3 completed tasks
    });

    it("per-task signals suppressed when task has group_id", async () => {
      const policy = { type: "all_required" };
      // 1 completed out of 3 -- not satisfied yet
      const state = buildGroupState(GROUP_ID, policy, "active", {
        total: 3,
        completed: 1,
        failed: 0,
        cancelled: 0,
        running: 2,
        pending: 0,
      });

      const { executor, dispatcher } = setupGroupTest({ policy, state });

      await dispatcher.onTaskUpdate("task_triggering", "active", "completed");

      // No per-task signal (task_completion/task_failure) should be sent
      const signalCalls = executor.signal.mock.calls as Array<
        [string, { type: string }]
      >;
      const perTaskSignals = signalCalls.filter(
        (call) =>
          call[1].type === "task_completion" || call[1].type === "task_failure",
      );
      expect(perTaskSignals.length).toBe(0);

      // findActiveForTask should NOT have been called (group path, not per-task path)
      expect(executor.findActiveForTask).not.toHaveBeenCalled();
    });
  });
});
