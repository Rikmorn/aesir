/**
 * Tests for Create Branch Node
 */

import type { DevWorkflowStateType } from "@aesir/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CreateBranchConfig, createBranchNode } from "./create-branch.js";

// Mock the GitHub integration module
vi.mock("../../integrations/github/index.js", () => ({
  createBranch: vi.fn(),
}));

import { createBranch } from "@aesir/integrations";

const mockCreateBranch = vi.mocked(createBranch);

describe("createBranchNode", () => {
  // Mock Octokit
  const mockOctokit = {} as Parameters<typeof createBranchNode>[0];

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
    vi.clearAllMocks();
  });

  it("should create branch with correct name pattern", async () => {
    mockCreateBranch.mockResolvedValue({
      name: "dev-agent/ABC-123",
      sha: "abc123",
      protected: false,
    });

    const createBranchNodeFn = createBranchNode(mockOctokit, config);
    await createBranchNodeFn(baseState);

    expect(mockCreateBranch).toHaveBeenCalledWith(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branchName: "dev-agent/ABC-123",
      baseBranch: "main",
    });
  });

  it("should return branch name in state update", async () => {
    mockCreateBranch.mockResolvedValue({
      name: "dev-agent/ABC-123",
      sha: "abc123",
      protected: false,
    });

    const createBranchNodeFn = createBranchNode(mockOctokit, config);
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

    mockCreateBranch.mockResolvedValue({
      name: "dev-agent/ABC-123",
      sha: "abc123",
      protected: false,
    });

    const createBranchNodeFn = createBranchNode(mockOctokit, customConfig);
    await createBranchNodeFn(baseState);

    expect(mockCreateBranch).toHaveBeenCalledWith(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branchName: "dev-agent/ABC-123",
      baseBranch: "develop",
    });
  });

  it("should handle different task IDs", async () => {
    mockCreateBranch.mockResolvedValue({
      name: "dev-agent/TASK-999",
      sha: "def456",
      protected: false,
    });

    const stateWithDifferentTask = {
      ...baseState,
      taskId: "TASK-999",
      sessionId: "session-test",
    };

    const createBranchNodeFn = createBranchNode(mockOctokit, config);
    const result = await createBranchNodeFn(stateWithDifferentTask);

    expect(result).toEqual({
      branchName: "dev-agent/TASK-999",
    });
  });

  it("should propagate createBranch errors", async () => {
    mockCreateBranch.mockRejectedValue(new Error("Branch already exists"));

    const createBranchNodeFn = createBranchNode(mockOctokit, config);
    await expect(createBranchNodeFn(baseState)).rejects.toThrow(
      "Branch already exists",
    );
  });

  it("should propagate network errors", async () => {
    mockCreateBranch.mockRejectedValue(new Error("Network error"));

    const createBranchNodeFn = createBranchNode(mockOctokit, config);
    await expect(createBranchNodeFn(baseState)).rejects.toThrow(
      "Network error",
    );
  });
});
