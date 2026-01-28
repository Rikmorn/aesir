/**
 * Tests for Commit and PR Node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevWorkflowStateType } from "../state/index.js";
import { type CommitPRConfig, createCommitPRNode } from "./commit-pr.js";

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

describe("createCommitPRNode", () => {
  // Config for tests
  const config: CommitPRConfig = {
    owner: "test-owner",
    repo: "test-repo",
    baseBranch: "main",
  };

  // Base state for tests
  const baseState: DevWorkflowStateType = {
    taskId: "ABC-123",
    sessionId: "session-test",
    taskDescription: "Implement feature X\n\nDetailed description here",
    repositoryUrl: null,
    branchName: "dev-agent/ABC-123",
    files: [
      {
        path: "src/feature.ts",
        content: "export const x = 1;",
        operation: "create",
      },
      {
        path: "src/index.ts",
        content: "export * from './feature.js';",
        operation: "update",
      },
    ],
    testResult: {
      passed: true,
      exitCode: 0,
      stdout: "All tests passed",
      stderr: "",
      summary: "2 tests passed",
    },
    testAttempts: 1,
    status: "testing",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("should call create_commit MCP tool with correct params", async () => {
    mockFetch
      // First call: create_commit
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      // Second call: create_pull_request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      // Third call: update_issue_status
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    await commitPRNode(baseState);

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/mcp/tools/create_commit"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          branch: "dev-agent/ABC-123",
          message: "feat: implement ABC-123",
          files: [
            { path: "src/feature.ts", content: "export const x = 1;" },
            { path: "src/index.ts", content: "export * from './feature.js';" },
          ],
        }),
      }),
    );
  });

  it("should filter out delete operations", async () => {
    const stateWithDelete: DevWorkflowStateType = {
      ...baseState,
      files: [
        {
          path: "src/feature.ts",
          content: "export const x = 1;",
          operation: "create",
        },
        { path: "src/old.ts", content: "", operation: "delete" },
        {
          path: "src/updated.ts",
          content: "updated content",
          operation: "update",
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    await commitPRNode(stateWithDelete);

    // Should only include create and update, not delete
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          branch: "dev-agent/ABC-123",
          message: "feat: implement ABC-123",
          files: [
            { path: "src/feature.ts", content: "export const x = 1;" },
            { path: "src/updated.ts", content: "updated content" },
          ],
        }),
      }),
    );
  });

  it("should call create_pull_request MCP tool with correct params", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    await commitPRNode(baseState);

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/mcp/tools/create_pull_request"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          title: "[ABC-123] Implement feature X",
          body: "Implements ABC-123\n\nGenerated by Dev Agent.",
          head: "dev-agent/ABC-123",
          base: "main",
        }),
      }),
    );
  });

  it("should call update_issue_status MCP tool to mark Done", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    await commitPRNode(baseState);

    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/mcp/tools/update_issue_status"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-ID": "dev-agent",
          "X-Correlation-ID": "test-corr-id",
        }),
        body: JSON.stringify({ issueId: "ABC-123", statusName: "Done" }),
      }),
    );
  });

  it("should return complete status and PR number", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    const result = await commitPRNode(baseState);

    expect(result).toEqual({
      status: "complete",
      prNumber: 42,
    });
  });

  it("should propagate MCP errors from create_commit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Commit failed",
        isError: true,
      }),
    } as unknown as Response);

    const commitPRNode = createCommitPRNode(config);
    await expect(commitPRNode(baseState)).rejects.toThrow();
  });

  it("should propagate MCP errors from create_pull_request", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: "PR creation failed",
          isError: true,
        }),
      } as unknown as Response);

    const commitPRNode = createCommitPRNode(config);
    await expect(commitPRNode(baseState)).rejects.toThrow();
  });

  it("should handle single-line task description", async () => {
    const stateWithSingleLine: DevWorkflowStateType = {
      ...baseState,
      taskDescription: "Simple task",
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            number: 42,
            url: "https://github.com/test-owner/test-repo/pull/42",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response);

    const commitPRNode = createCommitPRNode(config);
    await commitPRNode(stateWithSingleLine);

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          owner: "test-owner",
          repo: "test-repo",
          title: "[ABC-123] Simple task",
          body: "Implements ABC-123\n\nGenerated by Dev Agent.",
          head: "dev-agent/ABC-123",
          base: "main",
        }),
      }),
    );
  });
});
