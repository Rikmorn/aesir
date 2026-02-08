/**
 * create_task Tool Tests
 *
 * Unit tests for create_task tool factory including hierarchy guardrails:
 * - Basic task creation behavior
 * - Depth limit enforcement (MAX_TASK_DEPTH = 5)
 * - Subtask cap enforcement (MAX_SUBTASKS_PER_PARENT = 10)
 * - Circular delegation detection (non-consecutive same-assignee blocked)
 * - Self-decomposition allowed (consecutive same-assignee)
 * - Broken chain handling (fail safe)
 * - No-parentId bypass of all guardrails
 */

import { describe, expect, it, type Mock, vi } from "vitest";
import type { ToolContext } from "../../../framework/types.js";
import type { TaskService } from "../../services/task-service.js";
import { createCreateTaskTool } from "./create-task.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockTaskService(): {
  [K in keyof TaskService]: Mock;
} {
  return {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    addHandoff: vi.fn(),
    transitionWithHandoff: vi.fn(),
    getHandoffs: vi.fn(),
    getLatestHandoff: vi.fn(),
    listByAssignee: vi.fn(),
    listByParent: vi.fn(),
    linkConversation: vi.fn(),
    health: vi.fn(),
    close: vi.fn(),
  };
}

function createMockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: "dev-agent",
    correlationId: "conv_test123",
    taskId: undefined,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as ToolContext["logger"],
    ...overrides,
  } as ToolContext;
}

interface MockTaskOverrides {
  id?: string;
  parent_id?: string | null;
  assignee_type?: string;
  assignee_id?: string;
  creator_type?: string;
  creator_id?: string;
  status?: string;
  title?: string;
  objective?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
  completed_at?: Date | null;
}

function mockTask(overrides: MockTaskOverrides = {}) {
  return {
    id: "task_1",
    parent_id: null,
    assignee_type: "agent",
    assignee_id: "dev-agent",
    creator_type: "agent",
    creator_id: "dev-agent",
    status: "active",
    title: "Test task",
    objective: null,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

const validInput = {
  title: "Test task",
  assigneeType: "agent",
  assigneeId: "dev-agent",
};

// ---------------------------------------------------------------------------
// Tests: Basic behavior
// ---------------------------------------------------------------------------

describe("create_task - basic behavior", () => {
  it("creates task and links to conversation when ctx.taskId is undefined", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute(validInput);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
    expect(result.content).toContain("Conversation linked");
    expect(ts.create).toHaveBeenCalledOnce();
    expect(ts.linkConversation).toHaveBeenCalledWith(
      "task_new",
      "conv_test123",
    );
    expect(ctx.taskId).toBe("task_new");
  });

  it("creates task without linking when ctx.taskId is already set", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_existing" });
    const tool = createCreateTaskTool(ts, ctx);

    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);

    const result = await tool.execute(validInput);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
    expect(result.content).toContain("not linked");
    expect(ts.linkConversation).not.toHaveBeenCalled();
  });

  it("returns error on invalid input", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
    expect(ts.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Depth limit
// ---------------------------------------------------------------------------

describe("create_task - depth limit", () => {
  it("allows subtask at depth 1 (direct child of root)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // Parent is a root task (no parent_id)
    ts.get.mockResolvedValue(mockTask({ id: "task_root", parent_id: null }));
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_child" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      parentId: "task_root",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_child");
    expect(ts.create).toHaveBeenCalledOnce();
  });

  it("allows subtask at depth 4 (just under limit)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // Chain: task_4 -> task_3 -> task_2 -> task_1 (root)
    // New task would be at depth 5 from root, but depth count is 4 ancestors
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_4: mockTask({ id: "task_4", parent_id: "task_3" }),
        task_3: mockTask({ id: "task_3", parent_id: "task_2" }),
        task_2: mockTask({ id: "task_2", parent_id: "task_1" }),
        task_1: mockTask({ id: "task_1", parent_id: null }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      parentId: "task_4",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });

  it("rejects subtask at depth 5 (exceeds limit)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // Chain: task_5 -> task_4 -> task_3 -> task_2 -> task_1 (root)
    // New task would be at depth 6, exceeding MAX_TASK_DEPTH of 5
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_5: mockTask({ id: "task_5", parent_id: "task_4" }),
        task_4: mockTask({ id: "task_4", parent_id: "task_3" }),
        task_3: mockTask({ id: "task_3", parent_id: "task_2" }),
        task_2: mockTask({ id: "task_2", parent_id: "task_1" }),
        task_1: mockTask({ id: "task_1", parent_id: null }),
      };
      return tasks[id] ?? null;
    });

    const result = await tool.execute({
      ...validInput,
      parentId: "task_5",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("maximum nesting depth");
    expect(result.content).toContain("5");
    expect(ts.create).not.toHaveBeenCalled();
  });

  it("rejects when parent chain is broken (missing task)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // task_2 -> task_1 (missing)
    ts.get.mockImplementation(async (id: string) => {
      if (id === "task_2") {
        return mockTask({ id: "task_2", parent_id: "task_missing" });
      }
      return null; // task_missing not found
    });

    const result = await tool.execute({
      ...validInput,
      parentId: "task_2",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("parent chain is broken");
    expect(result.content).toContain("task_missing");
    expect(ts.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Subtask cap
// ---------------------------------------------------------------------------

describe("create_task - subtask cap", () => {
  it("allows subtask when parent has fewer than 10 children", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_parent", parent_id: null }));
    // 9 existing children -- under the limit
    ts.listByParent.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => mockTask({ id: `task_child_${i}` })),
    );
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      parentId: "task_parent",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });

  it("rejects subtask when parent already has 10 children", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_parent", parent_id: null }));
    // 10 existing children -- at the limit
    ts.listByParent.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => mockTask({ id: `task_child_${i}` })),
    );

    const result = await tool.execute({
      ...validInput,
      parentId: "task_parent",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("already has 10 subtasks");
    expect(result.content).toContain("maximum 10");
    expect(ts.create).not.toHaveBeenCalled();
  });

  it("allows first subtask (empty children list)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_parent", parent_id: null }));
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      parentId: "task_parent",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });
});

// ---------------------------------------------------------------------------
// Tests: Circular delegation
// ---------------------------------------------------------------------------

describe("create_task - circular delegation", () => {
  it("allows consecutive same-assignee (self-decomposition A->A->A)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // New task: assigned to dev-agent
    // Parent: dev-agent, Grandparent: dev-agent (all same = self-decomposition)
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_parent: mockTask({
          id: "task_parent",
          parent_id: "task_grandparent",
          assignee_type: "agent",
          assignee_id: "dev-agent",
        }),
        task_grandparent: mockTask({
          id: "task_grandparent",
          parent_id: null,
          assignee_type: "agent",
          assignee_id: "dev-agent",
        }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      assigneeType: "agent",
      assigneeId: "dev-agent",
      parentId: "task_parent",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });

  it("blocks non-consecutive same-assignee (A->B->A)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // New task: assigned to dev-agent
    // Parent: product-agent, Grandparent: dev-agent
    // Pattern: dev-agent -> product-agent -> dev-agent = circular delegation
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_parent: mockTask({
          id: "task_parent",
          parent_id: "task_grandparent",
          assignee_type: "agent",
          assignee_id: "product-agent",
        }),
        task_grandparent: mockTask({
          id: "task_grandparent",
          parent_id: null,
          assignee_type: "agent",
          assignee_id: "dev-agent",
        }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);

    const result = await tool.execute({
      ...validInput,
      assigneeType: "agent",
      assigneeId: "dev-agent",
      parentId: "task_parent",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("circular delegation");
    expect(result.content).toContain("dev-agent");
    expect(ts.create).not.toHaveBeenCalled();
  });

  it("allows when all ancestors have different assignees", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // New task: assigned to agent-c
    // Parent: agent-b, Grandparent: agent-a
    // All different = no circular delegation
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_parent: mockTask({
          id: "task_parent",
          parent_id: "task_grandparent",
          assignee_type: "agent",
          assignee_id: "agent-b",
        }),
        task_grandparent: mockTask({
          id: "task_grandparent",
          parent_id: null,
          assignee_type: "agent",
          assignee_id: "agent-a",
        }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      assigneeType: "agent",
      assigneeId: "agent-c",
      parentId: "task_parent",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });

  it("blocks circular delegation deeper in chain (A->B->C->A)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // New task: assigned to dev-agent
    // Parent: agent-c, Grandparent: agent-b, Great-grandparent: dev-agent
    // Pattern: dev-agent -> agent-c -> agent-b -> dev-agent = circular delegation
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_parent: mockTask({
          id: "task_parent",
          parent_id: "task_grandparent",
          assignee_type: "agent",
          assignee_id: "agent-c",
        }),
        task_grandparent: mockTask({
          id: "task_grandparent",
          parent_id: "task_greatgrand",
          assignee_type: "agent",
          assignee_id: "agent-b",
        }),
        task_greatgrand: mockTask({
          id: "task_greatgrand",
          parent_id: null,
          assignee_type: "agent",
          assignee_id: "dev-agent",
        }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);

    const result = await tool.execute({
      ...validInput,
      assigneeType: "agent",
      assigneeId: "dev-agent",
      parentId: "task_parent",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("circular delegation");
    expect(ts.create).not.toHaveBeenCalled();
  });

  it("allows when assignee only appears consecutively at the start (A->A->B->new-C)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    // New task: assigned to agent-c (not in chain at all)
    // Parent: agent-b, Grandparent: agent-a, Great-grandparent: agent-a
    // Chain has consecutive same (agent-a->agent-a) but new task (agent-c) is not in chain
    ts.get.mockImplementation(async (id: string) => {
      const tasks: Record<string, ReturnType<typeof mockTask>> = {
        task_parent: mockTask({
          id: "task_parent",
          parent_id: "task_grandparent",
          assignee_type: "agent",
          assignee_id: "agent-b",
        }),
        task_grandparent: mockTask({
          id: "task_grandparent",
          parent_id: "task_greatgrand",
          assignee_type: "agent",
          assignee_id: "agent-a",
        }),
        task_greatgrand: mockTask({
          id: "task_greatgrand",
          parent_id: null,
          assignee_type: "agent",
          assignee_id: "agent-a",
        }),
      };
      return tasks[id] ?? null;
    });
    ts.listByParent.mockResolvedValue([]);
    const createdTask = mockTask({ id: "task_new" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute({
      ...validInput,
      assigneeType: "agent",
      assigneeId: "agent-c",
      parentId: "task_parent",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_new");
  });
});

// ---------------------------------------------------------------------------
// Tests: No parentId (bypass guardrails)
// ---------------------------------------------------------------------------

describe("create_task - no parentId (bypass guardrails)", () => {
  it("skips all hierarchy checks when parentId is not provided", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createCreateTaskTool(ts, ctx);

    const createdTask = mockTask({ id: "task_root" });
    ts.create.mockResolvedValue(createdTask);
    ts.linkConversation.mockResolvedValue(undefined);

    const result = await tool.execute(validInput);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task_root");
    // Should NOT have called get() or listByParent() for hierarchy checks
    expect(ts.get).not.toHaveBeenCalled();
    expect(ts.listByParent).not.toHaveBeenCalled();
  });
});
