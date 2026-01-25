/**
 * Tests for Create Branch Node
 */

import type { DevWorkflowStateType } from "@aesir/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CreateBranchConfig, createBranchNode } from "./create-branch.js";

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

// Mock @aesir/common to prevent environment validation
vi.mock("@aesir/common", async () => {
  const actual = (await vi.importActual("@aesir/common")) as object;
  return {
    ...actual,
    generateCorrelationId: () => "test-corr-id",
  };
});

describe("createBranchNode", () => {
  // Config for tests
  const config: CreateBranchConfig = {
    owner: "test-owner",
    repo: "test-repo",
    baseBranch: "main",
  };

  // Base state for tests
  const baseState: DevWorkflowStateType = {
    taskId: "ABC-123",
    sessionId: "session-test",
    taskDescription: "Test task description",
    repositoryUrl: null,
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "coding",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("should call create_branch MCP tool with correct params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    const createBranchNodeFn = createBranchNode(config);
    await createBranchNodeFn(baseState);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/mcp/tools/create_branch"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          branchName: "dev-agent/ABC-123",
          baseBranch: "main",
        }),
      }),
    );
  });

  it("should return branch name in state update", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    const createBranchNodeFn = createBranchNode(config);
    const result = await createBranchNodeFn(baseState);

    expect(result).toEqual({
      branchName: "dev-agent/ABC-123",
    });
  });

  it("should use configured base branch", async () => {
    const customConfig: CreateBranchConfig = {
      owner: "test-owner",
      repo: "test-repo",
      baseBranch: "develop",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    const createBranchNodeFn = createBranchNode(customConfig);
    await createBranchNodeFn(baseState);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          branchName: "dev-agent/ABC-123",
          baseBranch: "develop",
        }),
      }),
    );
  });

  it("should handle different task IDs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    const stateWithDifferentTask = {
      ...baseState,
      taskId: "TASK-999",
    };

    const createBranchNodeFn = createBranchNode(config);
    const result = await createBranchNodeFn(stateWithDifferentTask);

    expect(result).toEqual({
      branchName: "dev-agent/TASK-999",
    });
  });

  it("should propagate MCP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Branch already exists",
        isError: true,
      }),
    } as unknown as Response);

    const createBranchNodeFn = createBranchNode(config);
    await expect(createBranchNodeFn(baseState)).rejects.toThrow();
  });

  it("should propagate network errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const createBranchNodeFn = createBranchNode(config);
    await expect(createBranchNodeFn(baseState)).rejects.toThrow(
      "Network error",
    );
  });
});
