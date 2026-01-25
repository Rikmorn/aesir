/**
 * GitHub Activities Tests
 *
 * Tests for GitHub Temporal activities.
 * Mocks MCP calls to verify activity behavior.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MergePRInput, mergePRActivity } from "./github-activities.js";

// Mock the MCP client
vi.mock("../../mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Import the mocked function
import { callMcpTool } from "../../mcp/index.js";

describe("mergePRActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls MCP with correct parameters", async () => {
    vi.mocked(callMcpTool).mockResolvedValue({
      sha: "abc123def",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "test-owner",
      repo: "test-repo",
      pullNumber: 42,
    };

    await mergePRActivity(input);

    expect(callMcpTool).toHaveBeenCalledWith({
      integration: "github",
      tool: "merge_pull_request",
      params: {
        owner: "test-owner",
        repo: "test-repo",
        pullNumber: 42,
        mergeMethod: "squash",
      },
      agentId: "temporal-worker",
      correlationId: "github-merge-test-owner/test-repo#42",
    });
  });

  it("passes merge method when provided", async () => {
    vi.mocked(callMcpTool).mockResolvedValue({
      sha: "def456ghi",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 99,
      mergeMethod: "rebase",
    };

    await mergePRActivity(input);

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          mergeMethod: "rebase",
        }),
      }),
    );
  });

  it("returns merge result", async () => {
    vi.mocked(callMcpTool).mockResolvedValue({
      sha: "xyz789abc",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 123,
    };

    const result = await mergePRActivity(input);

    expect(result).toEqual({
      sha: "xyz789abc",
      merged: true,
    });
  });

  it("propagates errors from MCP", async () => {
    const error = new Error("PR has merge conflicts");
    vi.mocked(callMcpTool).mockRejectedValue(error);

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 456,
    };

    await expect(mergePRActivity(input)).rejects.toThrow(
      "PR has merge conflicts",
    );
  });
});
