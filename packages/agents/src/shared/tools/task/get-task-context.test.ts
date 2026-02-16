/**
 * get_task_context Tool Tests
 *
 * Unit tests for createGetTaskContextTool(). Verifies:
 * - Graceful informational return when no taskId exists (QF-01)
 * - Normal operation with a valid taskId
 * - Task not found error
 * - Handoff rendering in chronological order
 */

import { describe, expect, it, type Mock, vi } from "vitest";
import type { ToolContext } from "../../../framework/types.js";
import type { TaskService } from "../../services/task-service.js";
import { createGetTaskContextTool } from "./get-task-context.js";

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
    setDispatcher: vi.fn(),
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

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    parent_id: null,
    assignee_type: "agent",
    assignee_id: "dev-agent",
    creator_type: "agent",
    creator_id: "dev-agent",
    status: "active",
    title: "Test task",
    objective: "Do the thing",
    metadata: {},
    created_at: new Date("2026-02-16T00:00:00Z"),
    updated_at: new Date("2026-02-16T00:00:00Z"),
    completed_at: null,
    ...overrides,
  };
}

function mockHandoff(overrides: Record<string, unknown> = {}) {
  return {
    id: "handoff_1",
    task_id: "task_1",
    handoff_type: "delegation",
    author_type: "agent",
    author_id: "dev-agent",
    context: { summary: "Delegated to coder" },
    created_at: new Date("2026-02-16T01:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: No taskId (QF-01 fix)
// ---------------------------------------------------------------------------

describe("get_task_context - no taskId", () => {
  it("returns informational content (not isError) when no taskId exists", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx(); // no taskId
    const tool = createGetTaskContextTool(ts, ctx);

    const result = await tool.execute({});

    expect(result.content).toBe("No active tasks found for this conversation.");
    expect(result.isError).toBeUndefined();
    // Should not have called any task service methods
    expect(ts.get).not.toHaveBeenCalled();
    expect(ts.getHandoffs).not.toHaveBeenCalled();
  });

  it("returns informational content when taskId input is also absent", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: undefined });
    const tool = createGetTaskContextTool(ts, ctx);

    // Explicitly pass no taskId in input
    const result = await tool.execute({ taskId: undefined });

    expect(result.content).toBe("No active tasks found for this conversation.");
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Normal operation with valid taskId
// ---------------------------------------------------------------------------

describe("get_task_context - valid taskId", () => {
  it("returns task metadata when a valid taskId is provided via input", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createGetTaskContextTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_abc" }));
    ts.getHandoffs.mockResolvedValue([]);

    const result = await tool.execute({ taskId: "task_abc" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task: task_abc");
    expect(result.content).toContain("Title: Test task");
    expect(result.content).toContain("Objective: Do the thing");
    expect(result.content).toContain("Status: active");
    expect(result.content).toContain("No handoffs recorded yet.");
    expect(ts.get).toHaveBeenCalledWith("task_abc");
  });

  it("returns task metadata when taskId comes from ctx", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_from_ctx" });
    const tool = createGetTaskContextTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask({ id: "task_from_ctx" }));
    ts.getHandoffs.mockResolvedValue([]);

    const result = await tool.execute({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task: task_from_ctx");
    expect(ts.get).toHaveBeenCalledWith("task_from_ctx");
  });

  it("renders handoffs in chronological order", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx({ taskId: "task_1" });
    const tool = createGetTaskContextTool(ts, ctx);

    ts.get.mockResolvedValue(mockTask());
    // Service returns DESC order (most recent first)
    ts.getHandoffs.mockResolvedValue([
      mockHandoff({
        id: "handoff_2",
        handoff_type: "completion",
        author_id: "coder",
        context: { summary: "Finished implementation" },
        created_at: new Date("2026-02-16T02:00:00Z"),
      }),
      mockHandoff({
        id: "handoff_1",
        handoff_type: "delegation",
        author_id: "dev-agent",
        context: { summary: "Delegated to coder" },
        created_at: new Date("2026-02-16T01:00:00Z"),
      }),
    ]);

    const result = await tool.execute({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Handoffs (2)");
    // First handoff should be the older delegation (chronological = reversed)
    const lines = result.content.split("\n");
    const delegationIdx = lines.findIndex((l: string) =>
      l.includes("[delegation]"),
    );
    const completionIdx = lines.findIndex((l: string) =>
      l.includes("[completion]"),
    );
    expect(delegationIdx).toBeLessThan(completionIdx);
  });
});

// ---------------------------------------------------------------------------
// Tests: Error cases
// ---------------------------------------------------------------------------

describe("get_task_context - error cases", () => {
  it("returns isError when task is not found", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createGetTaskContextTool(ts, ctx);

    ts.get.mockResolvedValue(null);

    const result = await tool.execute({ taskId: "task_nonexistent" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Task not found: task_nonexistent");
  });

  it("returns isError on service failure", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createGetTaskContextTool(ts, ctx);

    ts.get.mockRejectedValue(new Error("DB connection failed"));

    const result = await tool.execute({ taskId: "task_1" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Failed to get task context");
    expect(result.content).toContain("DB connection failed");
  });

  it("returns isError on invalid input", async () => {
    const ts = createMockTaskService();
    const ctx = createMockCtx();
    const tool = createGetTaskContextTool(ts, ctx);

    // Zod should reject non-string taskId
    const result = await tool.execute({ taskId: 12345 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });
});
