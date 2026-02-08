/**
 * complete_task Tool Tests
 *
 * Unit tests for complete_task tool factory including:
 * - Happy path: active task completed successfully
 * - Missing taskId → error
 * - Task not found → error
 * - Falls back to ctx.taskId when no explicit taskId
 * - Invalid transition (paused → completed) → error
 * - Cancelled task → error (NOT idempotent)
 * - Same-conversation double-completion → success no-op
 * - Different-conversation on completed task → error
 * - Completed task with no handoff → error
 */

import { describe, expect, it, type Mock, vi } from "vitest";
import type { ToolContext } from "../../../framework/types.js";
import type { TaskService } from "../../services/task-service.js";
import { createCompleteTaskTool } from "./complete-task.js";

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
    agentId: "product-agent",
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
    assignee_id: "product-agent",
    creator_type: "agent",
    creator_id: "product-agent",
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
  summary: "Created Linear issue AES-42 for user authentication feature",
  key_decisions: ["Scoped to JWT auth only", "SMS deferred"],
  artifacts: { issue: "AES-42" },
};

// ---------------------------------------------------------------------------
// Tests: Happy path
// ---------------------------------------------------------------------------

describe("complete_task - happy path", () => {
  it("completes an active task successfully", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_1" });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "active" }));
    ts.transitionWithHandoff.mockResolvedValue({
      task: mockTask({ id: "task_1", status: "completed" }),
      handoff: { id: "ho_1" },
    });

    const result = await tool.execute(validInput);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task completed: task_1");
    expect(result.content).toContain("Status: completed");
    expect(ts.transitionWithHandoff).toHaveBeenCalledWith(
      "task_1",
      "completed",
      expect.objectContaining({
        conversationId: "conv_test123",
        handoffType: "completion",
        context: expect.objectContaining({
          summary: validInput.summary,
          key_decisions: validInput.key_decisions,
          artifacts: validInput.artifacts,
        }),
        authorType: "agent",
        authorId: "product-agent",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Input validation and fallbacks
// ---------------------------------------------------------------------------

describe("complete_task - input validation", () => {
  it("returns error when no taskId and no ctx.taskId", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: undefined });
    const tool = createCompleteTaskTool(ts, ctx);

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("No task ID");
    expect(ts.get).not.toHaveBeenCalled();
  });

  it("returns error when task not found", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_missing" });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(null);

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Task not found: task_missing");
  });

  it("falls back to ctx.taskId when no explicit taskId", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_ctx" });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_ctx", status: "active" }));
    ts.transitionWithHandoff.mockResolvedValue({
      task: mockTask({ id: "task_ctx", status: "completed" }),
      handoff: { id: "ho_1" },
    });

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBeUndefined();
    expect(ts.get).toHaveBeenCalledWith("task_ctx");
    expect(result.content).toContain("task_ctx");
  });
});

// ---------------------------------------------------------------------------
// Tests: Invalid transitions
// ---------------------------------------------------------------------------

describe("complete_task - invalid transitions", () => {
  it("returns error for paused → completed", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_1" });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "paused" }));

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('status is "paused"');
    expect(result.content).toContain("active, cancelled");
    expect(ts.transitionWithHandoff).not.toHaveBeenCalled();
  });

  it("returns error for cancelled task (NOT idempotent)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_1" });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "cancelled" }));

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('status is "cancelled"');
    expect(result.content).toContain("none (terminal state)");
    expect(ts.transitionWithHandoff).not.toHaveBeenCalled();
    // Importantly: getLatestHandoff should NOT be called for cancelled tasks
    expect(ts.getLatestHandoff).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Idempotency (same-conversation double-completion)
// ---------------------------------------------------------------------------

describe("complete_task - idempotency", () => {
  it("returns success no-op when same conversation double-completes", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({
      taskId: "task_1",
      correlationId: "conv_original",
    });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "completed" }));
    ts.getLatestHandoff.mockResolvedValue({
      id: "ho_1",
      task_id: "task_1",
      conversation_id: "conv_original", // Same conversation
      handoff_type: "completion",
      context: { summary: "Already done" },
      author_type: "agent",
      author_id: "product-agent",
      created_at: new Date(),
    });

    const result = await tool.execute({ summary: "Done again" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task already completed: task_1");
    expect(result.content).toContain("Status: completed");
    // Should NOT write another handoff
    expect(ts.transitionWithHandoff).not.toHaveBeenCalled();
    // Should log a warning
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      { taskId: "task_1", conversationId: "conv_original" },
      "Same-conversation double-completion detected, treating as no-op",
    );
  });

  it("returns error when different conversation tries to complete", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({
      taskId: "task_1",
      correlationId: "conv_different",
    });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "completed" }));
    ts.getLatestHandoff.mockResolvedValue({
      id: "ho_1",
      task_id: "task_1",
      conversation_id: "conv_original", // Different conversation
      handoff_type: "completion",
      context: { summary: "Done by original" },
      author_type: "agent",
      author_id: "product-agent",
      created_at: new Date(),
    });

    const result = await tool.execute({ summary: "Done from other conv" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('status is "completed"');
    expect(ts.transitionWithHandoff).not.toHaveBeenCalled();
  });

  it("returns error when completed task has no handoff (cannot verify same-conversation)", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({
      taskId: "task_1",
      correlationId: "conv_test123",
    });
    const tool = createCompleteTaskTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_1", status: "completed" }));
    ts.getLatestHandoff.mockResolvedValue(null);

    const result = await tool.execute({ summary: "Done" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('status is "completed"');
    expect(ts.transitionWithHandoff).not.toHaveBeenCalled();
  });
});
