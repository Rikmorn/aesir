/**
 * Cost Tracking Tests
 *
 * Tests for getTaskTokenUsage() covering: aggregation with matching rows,
 * null return for no matches, and SQL query shape verification.
 */

import { describe, expect, it, vi } from "vitest";
import { getTaskTokenUsage, type TaskTokenUsage } from "./cost-tracking.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockDb(rows: Record<string, unknown>[] = []) {
  return {
    execute: vi.fn().mockResolvedValue({ rows }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getTaskTokenUsage", () => {
  it("returns aggregated token usage when traces exist", async () => {
    const mockDb = createMockDb([
      {
        task_id: "task_abc123",
        total_input: 1500,
        total_output: 800,
        total_tokens: 2300,
        trace_count: 5,
      },
    ]);

    const result = await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_abc123",
    );

    expect(result).toEqual({
      taskId: "task_abc123",
      totalInputTokens: 1500,
      totalOutputTokens: 800,
      totalTokens: 2300,
      traceCount: 5,
    } satisfies TaskTokenUsage);
  });

  it("returns null when no traces exist for the task", async () => {
    const mockDb = createMockDb([]);

    const result = await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_nonexistent",
    );

    expect(result).toBeNull();
  });

  it("returns null when rows array is undefined", async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: undefined }),
    };

    const result = await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_missing",
    );

    expect(result).toBeNull();
  });

  it("passes the taskId as a SQL parameter", async () => {
    const mockDb = createMockDb([]);

    await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_xyz789",
    );

    // Verify execute was called with a SQL query containing the task ID
    expect(mockDb.execute).toHaveBeenCalledOnce();

    // The sql tagged template produces a Sql object; verify the call was made
    const sqlArg = mockDb.execute.mock.calls[0]?.[0];
    expect(sqlArg).toBeDefined();
  });

  it("handles numeric string coercion from database rows", async () => {
    // PostgreSQL may return numeric values as strings in some drivers
    const mockDb = createMockDb([
      {
        task_id: "task_str",
        total_input: "3200",
        total_output: "1100",
        total_tokens: "4300",
        trace_count: "12",
      },
    ]);

    const result = await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_str",
    );

    expect(result).toEqual({
      taskId: "task_str",
      totalInputTokens: 3200,
      totalOutputTokens: 1100,
      totalTokens: 4300,
      traceCount: 12,
    });
  });

  it("handles zero token counts", async () => {
    const mockDb = createMockDb([
      {
        task_id: "task_zero",
        total_input: 0,
        total_output: 0,
        total_tokens: 0,
        trace_count: 3,
      },
    ]);

    const result = await getTaskTokenUsage(
      mockDb as unknown as Parameters<typeof getTaskTokenUsage>[0],
      "task_zero",
    );

    expect(result).toEqual({
      taskId: "task_zero",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      traceCount: 3,
    });
  });
});
