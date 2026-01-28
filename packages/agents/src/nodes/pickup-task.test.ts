/**
 * Tests for Pickup Task Node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevWorkflowStateType } from "../state/index.js";
import { createPickupTaskNode } from "./pickup-task.js";

// Create mock fetch using vi.hoisted
const { mockFetch } = vi.hoisted(() => {
  return {
    mockFetch: vi.fn(),
  };
});

// Mock fetch-retry-ts module
vi.mock("fetch-retry-ts", () => ({
  fetchBuilder: () => mockFetch,
}));

// Mock @aesir/types to prevent environment validation
vi.mock("@aesir/types", async () => {
  const actual = (await vi.importActual("@aesir/types")) as object;
  return {
    ...actual,
    generateCorrelationId: () => "test-corr-id",
  };
});

describe("createPickupTaskNode", () => {
  // Base state for tests
  const baseState: DevWorkflowStateType = {
    taskId: "ABC-123",
    sessionId: "session-test",
    taskDescription: "",
    repositoryUrl: null,
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "pending",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("should call get_issue MCP tool with correct params", async () => {
    mockFetch
      // First call: get_issue
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { title: "Test issue title", description: "Test description" },
        }),
      } as Response)
      // Second call: update_issue_status
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const pickupTask = createPickupTaskNode();
    await pickupTask(baseState);

    // Verify first call is to get_issue
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/mcp/tools/get_issue"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({ issueId: "ABC-123" }),
      }),
    );
  });

  it("should call update_issue_status MCP tool with correct params", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { title: "Test issue title", description: "Test description" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const pickupTask = createPickupTaskNode();
    await pickupTask(baseState);

    // Verify second call is to update_issue_status
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/mcp/tools/update_issue_status"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({ issueId: "ABC-123", statusName: "In Progress" }),
      }),
    );
  });

  it("should return task description and coding status", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { title: "Test issue title", description: "Test description" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const pickupTask = createPickupTaskNode();
    const result = await pickupTask(baseState);

    expect(result).toEqual({
      taskDescription: "Test issue title\n\nTest description",
      status: "coding",
    });
  });

  it("should handle issue with no description", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { title: "Title only issue" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const pickupTask = createPickupTaskNode();
    const result = await pickupTask(baseState);

    expect(result).toEqual({
      taskDescription: "Title only issue\n\n",
      status: "coding",
    });
  });

  it("should propagate MCP errors from get_issue", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Issue not found: ABC-123",
        isError: true,
      }),
    } as unknown as Response);

    const pickupTask = createPickupTaskNode();
    await expect(pickupTask(baseState)).rejects.toThrow();
  });

  it("should propagate MCP errors from update_issue_status", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { title: "Test issue", description: "Test description" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: "Status update failed",
          isError: true,
        }),
      } as unknown as Response);

    const pickupTask = createPickupTaskNode();
    await expect(pickupTask(baseState)).rejects.toThrow();
  });
});
