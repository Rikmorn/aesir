/**
 * Context Manager Tests
 *
 * Tests for createContextManager() covering: factory validation, snapshot write
 * operations, latest snapshot reads, stage-specific reads, optional field handling,
 * and health checks.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContextManagerOptions,
  createContextManager,
  type WriteSnapshotParams,
} from "./context-manager.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockDb() {
  // insert().values().returning()
  const returningFn = vi.fn().mockResolvedValue([{ id: "ctx_test123" }]);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  // select().from().where().orderBy().limit()
  const limitFn = vi.fn().mockResolvedValue([]);
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  // execute() for health check
  const executeFn = vi.fn().mockResolvedValue(undefined);

  return {
    insert: insertFn,
    select: selectFn,
    execute: executeFn,
    mockReturningFn: returningFn,
    mockValuesFn: valuesFn,
    mockLimitFn: limitFn,
    mockWhereFn: whereFn,
    mockOrderByFn: orderByFn,
    mockFromFn: fromFn,
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

function createDefaultSnapshotParams(
  overrides?: Partial<WriteSnapshotParams>,
): WriteSnapshotParams {
  return {
    taskId: "task_abc123",
    workflowId: "wf_xyz789",
    agentType: "dev-orchestrator",
    stage: "post-research",
    summary: "Researched authentication approaches",
    toolCallCount: 5,
    tokenCount: { input: 1000, output: 500 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createContextManager", () => {
  it("throws if db is missing", () => {
    const mockLogger = createMockLogger();
    expect(() =>
      createContextManager({
        db: undefined as unknown as ContextManagerOptions["db"],
        logger: mockLogger as unknown as ContextManagerOptions["logger"],
      }),
    ).toThrow("db is required for ContextManager");
  });

  it("throws if logger is missing", () => {
    const mockDb = createMockDb();
    expect(() =>
      createContextManager({
        db: mockDb as unknown as ContextManagerOptions["db"],
        logger: undefined as unknown as ContextManagerOptions["logger"],
      }),
    ).toThrow("logger is required for ContextManager");
  });
});

describe("writeSnapshot", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: ReturnType<typeof createContextManager>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    manager = createContextManager({
      db: mockDb as unknown as ContextManagerOptions["db"],
      logger: mockLogger as unknown as ContextManagerOptions["logger"],
    });
  });

  it("writes a context snapshot and returns the ID", async () => {
    const params = createDefaultSnapshotParams();
    const id = await manager.writeSnapshot(params);

    expect(id).toBe("ctx_test123");
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task_abc123",
        workflow_id: "wf_xyz789",
        agent_type: "dev-orchestrator",
        stage: "post-research",
        summary: "Researched authentication approaches",
        tool_call_count: 5,
        token_count: { input: 1000, output: 500 },
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "ctx_test123",
        taskId: "task_abc123",
        stage: "post-research",
      }),
      "Context snapshot written",
    );
  });

  it("throws if taskId is missing", async () => {
    const params = createDefaultSnapshotParams({ taskId: "" });
    await expect(manager.writeSnapshot(params)).rejects.toThrow(
      "taskId is required for writeSnapshot",
    );
  });

  it("throws if summary is missing", async () => {
    const params = createDefaultSnapshotParams({ summary: "" });
    await expect(manager.writeSnapshot(params)).rejects.toThrow(
      "summary is required for writeSnapshot",
    );
  });

  it("throws if workflowId is missing", async () => {
    const params = createDefaultSnapshotParams({ workflowId: "" });
    await expect(manager.writeSnapshot(params)).rejects.toThrow(
      "workflowId is required for writeSnapshot",
    );
  });

  it("throws if agentType is missing", async () => {
    const params = createDefaultSnapshotParams({ agentType: "" });
    await expect(manager.writeSnapshot(params)).rejects.toThrow(
      "agentType is required for writeSnapshot",
    );
  });

  it("includes optional fields when provided", async () => {
    const params = createDefaultSnapshotParams({
      completedActions: ["fetched issue", "analyzed code"],
      pendingIntent: "create implementation plan",
      knownIssues: ["auth token expiration"],
      projectContext: { framework: "express", language: "typescript" },
      keyFiles: ["src/auth.ts", "src/middleware.ts"],
      researchFindings: { apiDocs: "found OAuth2 flow" },
      plan: { steps: ["implement", "test"] },
    });

    await manager.writeSnapshot(params);

    expect(mockDb.mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        completed_actions: ["fetched issue", "analyzed code"],
        pending_intent: "create implementation plan",
        known_issues: ["auth token expiration"],
        project_context: { framework: "express", language: "typescript" },
        key_files: ["src/auth.ts", "src/middleware.ts"],
        research_findings: { apiDocs: "found OAuth2 flow" },
        plan: { steps: ["implement", "test"] },
      }),
    );
  });

  it("handles default values for optional fields", async () => {
    const params = createDefaultSnapshotParams();
    // No optional fields provided

    await manager.writeSnapshot(params);

    expect(mockDb.mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        completed_actions: [],
        pending_intent: undefined,
        known_issues: [],
        project_context: {},
        key_files: [],
        research_findings: undefined,
        plan: undefined,
      }),
    );
  });
});

describe("readLatestSnapshot", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: ReturnType<typeof createContextManager>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    manager = createContextManager({
      db: mockDb as unknown as ContextManagerOptions["db"],
      logger: mockLogger as unknown as ContextManagerOptions["logger"],
    });
  });

  it("returns the latest snapshot for task+workflow", async () => {
    const mockSnapshot = {
      id: "ctx_latest",
      task_id: "task_abc123",
      workflow_id: "wf_xyz789",
      agent_type: "dev-orchestrator",
      stage: "post-research",
      summary: "Latest context",
      completed_actions: [],
      pending_intent: null,
      known_issues: [],
      project_context: {},
      key_files: [],
      research_findings: null,
      plan: null,
      tool_call_count: 3,
      token_count: { input: 500, output: 200 },
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockDb.mockLimitFn.mockResolvedValueOnce([mockSnapshot]);

    const result = await manager.readLatestSnapshot("task_abc123", "wf_xyz789");

    expect(result).toEqual(mockSnapshot);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns null when no snapshot exists", async () => {
    mockDb.mockLimitFn.mockResolvedValueOnce([]);

    const result = await manager.readLatestSnapshot(
      "task_nonexistent",
      "wf_nonexistent",
    );

    expect(result).toBeNull();
  });
});

describe("readLatestSnapshotForStage", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: ReturnType<typeof createContextManager>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockLogger = createMockLogger();
    manager = createContextManager({
      db: mockDb as unknown as ContextManagerOptions["db"],
      logger: mockLogger as unknown as ContextManagerOptions["logger"],
    });
  });

  it("returns the latest snapshot for task+stage", async () => {
    const mockSnapshot = {
      id: "ctx_stage",
      task_id: "task_abc123",
      workflow_id: "wf_xyz789",
      agent_type: "dev-orchestrator",
      stage: "post-approval",
      summary: "Approval granted",
      completed_actions: ["plan approved"],
      pending_intent: "begin execution",
      known_issues: [],
      project_context: {},
      key_files: [],
      research_findings: null,
      plan: null,
      tool_call_count: 2,
      token_count: { input: 300, output: 100 },
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockDb.mockLimitFn.mockResolvedValueOnce([mockSnapshot]);

    const result = await manager.readLatestSnapshotForStage(
      "task_abc123",
      "post-approval",
    );

    expect(result).toEqual(mockSnapshot);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("returns null when no snapshot exists for stage", async () => {
    mockDb.mockLimitFn.mockResolvedValueOnce([]);

    const result = await manager.readLatestSnapshotForStage(
      "task_abc123",
      "post-execution",
    );

    expect(result).toBeNull();
  });
});

describe("health", () => {
  it("returns healthy status with latency", async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const manager = createContextManager({
      db: mockDb as unknown as ContextManagerOptions["db"],
      logger: mockLogger as unknown as ContextManagerOptions["logger"],
    });

    const result = await manager.health();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });

  it("returns unhealthy status on database error", async () => {
    const mockDb = createMockDb();
    mockDb.execute.mockRejectedValueOnce(new Error("Connection refused"));
    const mockLogger = createMockLogger();
    const manager = createContextManager({
      db: mockDb as unknown as ContextManagerOptions["db"],
      logger: mockLogger as unknown as ContextManagerOptions["logger"],
    });

    const result = await manager.health();

    expect(result.healthy).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
