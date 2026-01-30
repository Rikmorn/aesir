/**
 * Task Store Tests
 *
 * Tests for createTaskStore() covering: factory validation, task CRUD operations,
 * camelCase-to-snake_case field mapping, optional field handling, workflow ID lookups,
 * and health checks.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CreateTaskParams,
  createTaskStore,
  type TaskStoreOptions,
} from "./task-store.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockDb() {
  // insert().values().returning()
  const returningFn = vi.fn().mockResolvedValue([{ id: "at_test123" }]);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  // select().from().where().limit()
  const limitFn = vi.fn().mockResolvedValue([]);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  // update().set().where()
  const updateWhereFn = vi.fn().mockResolvedValue(undefined);
  const setFn = vi.fn().mockReturnValue({ where: updateWhereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });

  // execute() for health check
  const executeFn = vi.fn().mockResolvedValue(undefined);

  return {
    insert: insertFn,
    select: selectFn,
    update: updateFn,
    execute: executeFn,
    mockReturningFn: returningFn,
    mockValuesFn: valuesFn,
    mockLimitFn: limitFn,
    mockWhereFn: whereFn,
    mockSetFn: setFn,
    mockUpdateWhereFn: updateWhereFn,
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

function createDefaultTaskParams(
  overrides?: Partial<CreateTaskParams>,
): CreateTaskParams {
  return {
    taskId: "task_abc123",
    agentType: "dev",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTaskStore", () => {
  it("throws if db is missing", () => {
    const mockLogger = createMockLogger();
    expect(() =>
      createTaskStore({
        db: undefined as unknown as TaskStoreOptions["db"],
        logger: mockLogger as unknown as TaskStoreOptions["logger"],
      }),
    ).toThrow("db is required for TaskStore");
  });

  it("throws if logger is missing", () => {
    const mockDb = createMockDb();
    expect(() =>
      createTaskStore({
        db: mockDb as unknown as TaskStoreOptions["db"],
        logger: undefined as unknown as TaskStoreOptions["logger"],
      }),
    ).toThrow("logger is required for TaskStore");
  });
});

describe("createTask", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });
  });

  it("creates a task and returns the generated ID", async () => {
    const params = createDefaultTaskParams();
    const id = await store.createTask(params);

    expect(id).toBe("at_test123");
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task_abc123",
        agent_type: "dev",
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        taskDbId: "at_test123",
        taskId: "task_abc123",
        agentType: "dev",
      }),
      "Task created",
    );
  });

  it("throws if taskId is missing", async () => {
    const params = createDefaultTaskParams({ taskId: "" });
    await expect(store.createTask(params)).rejects.toThrow(
      "taskId is required for createTask",
    );
  });

  it("throws if agentType is missing", async () => {
    const params = createDefaultTaskParams({ agentType: "" });
    await expect(store.createTask(params)).rejects.toThrow(
      "agentType is required for createTask",
    );
  });

  it("includes optional fields when provided", async () => {
    const params = createDefaultTaskParams({
      issueId: "issue_uuid_123",
      issueIdentifier: "AES-42",
      workflowId: "wf_xyz789",
      slackChannel: "C1234567890",
      slackMessageTs: "1234567890.123456",
    });

    await store.createTask(params);

    expect(mockDb.mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task_abc123",
        agent_type: "dev",
        issue_id: "issue_uuid_123",
        issue_identifier: "AES-42",
        workflow_id: "wf_xyz789",
        slack_channel: "C1234567890",
        slack_message_ts: "1234567890.123456",
      }),
    );
  });
});

describe("updateTask", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });
  });

  it("updates task status", async () => {
    await store.updateTask("task_abc123", { status: "researching" });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockDb.mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "researching",
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_abc123",
        fields: ["status"],
      }),
      "Task updated",
    );
  });

  it("maps camelCase fields to snake_case columns", async () => {
    await store.updateTask("task_abc123", {
      workflowId: "wf_new",
      branchName: "feature/auth",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      approvalStatus: "approved",
      approvalFeedback: "Looks good",
      containerId: "container_abc",
      escalationReason: "Needs review",
      slackChannel: "C9999",
      slackMessageTs: "99999.99999",
    });

    expect(mockDb.mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "wf_new",
        branch_name: "feature/auth",
        pr_number: 42,
        pr_url: "https://github.com/org/repo/pull/42",
        approval_status: "approved",
        approval_feedback: "Looks good",
        container_id: "container_abc",
        escalation_reason: "Needs review",
        slack_channel: "C9999",
        slack_message_ts: "99999.99999",
      }),
    );
  });

  it("skips fields not provided in the update", async () => {
    // Only pass status -- branchName is not included at all
    await store.updateTask("task_abc123", {
      status: "executing",
    });

    const setCall = mockDb.mockSetFn.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(setCall.status).toBe("executing");
    expect(setCall).not.toHaveProperty("branch_name");
  });

  it("handles multiple fields at once", async () => {
    await store.updateTask("task_abc123", {
      status: "complete",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
    });

    expect(mockDb.mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complete",
        pr_number: 42,
        pr_url: "https://github.com/org/repo/pull/42",
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ["status", "prNumber", "prUrl"],
      }),
      "Task updated",
    );
  });

  it("logs warning and returns early when no valid fields provided", async () => {
    await store.updateTask("task_abc123", {});

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task_abc123" }),
      "updateTask called with no valid fields",
    );
  });
});

describe("getTask", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });
  });

  it("returns task when found", async () => {
    const mockTask = {
      id: "at_test123",
      task_id: "task_abc123",
      agent_type: "dev",
      issue_id: null,
      issue_identifier: null,
      workflow_id: "wf_xyz789",
      status: "researching",
      container_id: null,
      branch_name: null,
      pr_number: null,
      pr_url: null,
      approval_status: "pending",
      approval_feedback: null,
      error: null,
      escalation_reason: null,
      slack_channel: null,
      slack_message_ts: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockDb.mockLimitFn.mockResolvedValueOnce([mockTask]);

    const result = await store.getTask("task_abc123");

    expect(result).toEqual(mockTask);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns null when not found", async () => {
    mockDb.mockLimitFn.mockResolvedValueOnce([]);

    const result = await store.getTask("task_nonexistent");

    expect(result).toBeNull();
  });
});

describe("getTaskByWorkflowId", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });
  });

  it("returns task when found by workflow ID", async () => {
    const mockTask = {
      id: "at_test456",
      task_id: "task_def456",
      agent_type: "product",
      issue_id: null,
      issue_identifier: null,
      workflow_id: "wf_lookup",
      status: "planning",
      container_id: null,
      branch_name: null,
      pr_number: null,
      pr_url: null,
      approval_status: "pending",
      approval_feedback: null,
      error: null,
      escalation_reason: null,
      slack_channel: "C1234567890",
      slack_message_ts: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockDb.mockLimitFn.mockResolvedValueOnce([mockTask]);

    const result = await store.getTaskByWorkflowId("wf_lookup");

    expect(result).toEqual(mockTask);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns null when not found", async () => {
    mockDb.mockLimitFn.mockResolvedValueOnce([]);

    const result = await store.getTaskByWorkflowId("wf_nonexistent");

    expect(result).toBeNull();
  });
});

describe("health", () => {
  it("returns healthy status", async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });

    const result = await store.health();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });

  it("returns unhealthy status on database error", async () => {
    const mockDb = createMockDb();
    mockDb.execute.mockRejectedValueOnce(new Error("Connection refused"));
    const mockLogger = createMockLogger();
    const store = createTaskStore({
      db: mockDb as unknown as TaskStoreOptions["db"],
      logger: mockLogger as unknown as TaskStoreOptions["logger"],
    });

    const result = await store.health();

    expect(result.healthy).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
