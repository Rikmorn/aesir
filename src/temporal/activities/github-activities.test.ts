/**
 * GitHub Activities Tests
 *
 * Tests for GitHub Temporal activities.
 * Mocks mergePullRequest to verify activity behavior.
 */

import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MergePRInput, mergePRActivity } from "./github-activities.js";

// Mock the pull-requests module
vi.mock("../../integrations/github/pull-requests.js", () => ({
  mergePullRequest: vi.fn(),
}));

// Import the mocked function
import { mergePullRequest } from "../../integrations/github/pull-requests.js";

describe("mergePRActivity", () => {
  const mockOctokit = {} as Octokit;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls mergePullRequest with correct parameters", async () => {
    vi.mocked(mergePullRequest).mockResolvedValue({
      sha: "abc123def",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "test-owner",
      repo: "test-repo",
      pullNumber: 42,
    };

    await mergePRActivity(mockOctokit, input);

    expect(mergePullRequest).toHaveBeenCalledWith(
      mockOctokit,
      "test-owner",
      "test-repo",
      42,
      undefined,
    );
  });

  it("passes merge method when provided", async () => {
    vi.mocked(mergePullRequest).mockResolvedValue({
      sha: "def456ghi",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 99,
      mergeMethod: "rebase",
    };

    await mergePRActivity(mockOctokit, input);

    expect(mergePullRequest).toHaveBeenCalledWith(
      mockOctokit,
      "owner",
      "repo",
      99,
      { mergeMethod: "rebase" },
    );
  });

  it("returns merge result", async () => {
    vi.mocked(mergePullRequest).mockResolvedValue({
      sha: "xyz789abc",
      merged: true,
    });

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 123,
    };

    const result = await mergePRActivity(mockOctokit, input);

    expect(result).toEqual({
      sha: "xyz789abc",
      merged: true,
    });
  });

  it("propagates errors from mergePullRequest", async () => {
    const error = new Error("PR has merge conflicts");
    vi.mocked(mergePullRequest).mockRejectedValue(error);

    const input: MergePRInput = {
      owner: "owner",
      repo: "repo",
      pullNumber: 456,
    };

    await expect(mergePRActivity(mockOctokit, input)).rejects.toThrow(
      "PR has merge conflicts",
    );
  });
});
