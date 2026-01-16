/**
 * GitHub Pull Request Operations Tests
 *
 * Tests for pull request operations (create, get, list comments, add comment).
 * Uses mocked Octokit to verify correct API calls.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Octokit } from "@octokit/rest";
import {
  createPullRequest,
  getPullRequest,
  listPRComments,
  addPRComment,
  mergePullRequest,
} from "./pull-requests.js";

// Helper to get mock from Octokit methods
function asMock<T>(fn: T): Mock {
  return fn as unknown as Mock;
}

describe("createPullRequest", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        pulls: {
          create: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: "Add new feature",
              body: "This PR adds a cool feature",
              state: "open",
              head: { ref: "feature/add-auth" },
              base: { ref: "main" },
              html_url: "https://github.com/owner/repo/pull/42",
            },
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns correct PullRequestInfo on success", async () => {
    const result = await createPullRequest(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      title: "Add new feature",
      body: "This PR adds a cool feature",
      head: "feature/add-auth",
      base: "main",
    });

    expect(result).toEqual({
      number: 42,
      title: "Add new feature",
      body: "This PR adds a cool feature",
      state: "open",
      headBranch: "feature/add-auth",
      baseBranch: "main",
      url: "https://github.com/owner/repo/pull/42",
    });
  });

  it("calls pulls.create with correct parameters", async () => {
    await createPullRequest(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      title: "My PR",
      body: "Description",
      head: "feature-branch",
      base: "develop",
    });

    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      title: "My PR",
      body: "Description",
      head: "feature-branch",
      base: "develop",
    });
  });

  it("handles undefined body", async () => {
    await createPullRequest(mockOctokit, {
      owner: "owner",
      repo: "repo",
      title: "No body PR",
      head: "feature",
      base: "main",
    });

    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      title: "No body PR",
      body: undefined,
      head: "feature",
      base: "main",
    });
  });

  it("propagates error when creation fails", async () => {
    const error = new Error("No commits between branches");
    asMock(mockOctokit.rest.pulls.create).mockRejectedValue(error);

    await expect(
      createPullRequest(mockOctokit, {
        owner: "owner",
        repo: "repo",
        title: "Bad PR",
        head: "main",
        base: "main",
      })
    ).rejects.toThrow("No commits between branches");
  });
});

describe("getPullRequest", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 123,
              title: "Existing PR",
              body: "PR description",
              state: "closed",
              head: { ref: "old-feature" },
              base: { ref: "main" },
              html_url: "https://github.com/owner/repo/pull/123",
            },
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns correct PullRequestInfo", async () => {
    const result = await getPullRequest(
      mockOctokit,
      "owner",
      "repo",
      123
    );

    expect(result).toEqual({
      number: 123,
      title: "Existing PR",
      body: "PR description",
      state: "closed",
      headBranch: "old-feature",
      baseBranch: "main",
      url: "https://github.com/owner/repo/pull/123",
    });
  });

  it("calls pulls.get with correct parameters", async () => {
    await getPullRequest(mockOctokit, "test-owner", "test-repo", 456);

    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 456,
    });
  });

  it("propagates error when PR not found", async () => {
    const error = new Error("Not found");
    asMock(mockOctokit.rest.pulls.get).mockRejectedValue(error);

    await expect(
      getPullRequest(mockOctokit, "owner", "repo", 999)
    ).rejects.toThrow("Not found");
  });
});

describe("listPRComments", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        pulls: {
          listReviewComments: vi.fn().mockResolvedValue({
            data: [
              {
                id: 1,
                body: "Review comment on line 10",
                user: { login: "reviewer1" },
                created_at: "2026-01-15T10:00:00Z",
                path: "src/index.ts",
              },
              {
                id: 2,
                body: "Another review comment",
                user: { login: "reviewer2" },
                created_at: "2026-01-15T12:00:00Z",
                path: "src/utils.ts",
              },
            ],
          }),
        },
        issues: {
          listComments: vi.fn().mockResolvedValue({
            data: [
              {
                id: 100,
                body: "Issue comment in thread",
                user: { login: "commenter1" },
                created_at: "2026-01-15T11:00:00Z",
              },
              {
                id: 101,
                body: "Thanks for the feedback!",
                user: { login: "author" },
                created_at: "2026-01-15T13:00:00Z",
              },
            ],
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("combines review and issue comments sorted by time", async () => {
    const result = await listPRComments(mockOctokit, "owner", "repo", 42);

    expect(result).toHaveLength(4);
    // Verify sorted by createdAt
    expect(result[0]!.createdAt).toBe("2026-01-15T10:00:00Z"); // First review
    expect(result[1]!.createdAt).toBe("2026-01-15T11:00:00Z"); // Issue comment
    expect(result[2]!.createdAt).toBe("2026-01-15T12:00:00Z"); // Second review
    expect(result[3]!.createdAt).toBe("2026-01-15T13:00:00Z"); // Issue reply
  });

  it("review comments have path, issue comments do not", async () => {
    const result = await listPRComments(mockOctokit, "owner", "repo", 42);

    const reviewComment = result.find((c) => c.id === 1);
    const issueComment = result.find((c) => c.id === 100);

    expect(reviewComment?.path).toBe("src/index.ts");
    expect(issueComment?.path).toBeUndefined();
  });

  it("calls both listReviewComments and listComments", async () => {
    await listPRComments(mockOctokit, "test-owner", "test-repo", 99);

    expect(mockOctokit.rest.pulls.listReviewComments).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 99,
    });

    expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 99,
    });
  });

  it("returns empty array when no comments", async () => {
    asMock(mockOctokit.rest.pulls.listReviewComments).mockResolvedValue({
      data: [],
    });
    asMock(mockOctokit.rest.issues.listComments).mockResolvedValue({
      data: [],
    });

    const result = await listPRComments(mockOctokit, "owner", "repo", 42);

    expect(result).toEqual([]);
  });

  it("handles missing user info gracefully", async () => {
    asMock(mockOctokit.rest.pulls.listReviewComments).mockResolvedValue({
      data: [
        {
          id: 1,
          body: "Comment without user",
          user: null,
          created_at: "2026-01-15T10:00:00Z",
          path: "file.ts",
        },
      ],
    });
    asMock(mockOctokit.rest.issues.listComments).mockResolvedValue({
      data: [],
    });

    const result = await listPRComments(mockOctokit, "owner", "repo", 42);

    expect(result[0]!.user).toBe("unknown");
  });
});

describe("addPRComment", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        issues: {
          createComment: vi.fn().mockResolvedValue({
            data: {
              id: 999,
              body: "Thanks for the feedback, I'll fix that!",
              user: { login: "agent-bot" },
              created_at: "2026-01-16T14:00:00Z",
            },
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns created comment info", async () => {
    const result = await addPRComment(
      mockOctokit,
      "owner",
      "repo",
      42,
      "Thanks for the feedback, I'll fix that!"
    );

    expect(result).toEqual({
      id: 999,
      body: "Thanks for the feedback, I'll fix that!",
      user: "agent-bot",
      createdAt: "2026-01-16T14:00:00Z",
    });
  });

  it("calls issues.createComment with correct parameters", async () => {
    await addPRComment(
      mockOctokit,
      "test-owner",
      "test-repo",
      123,
      "My comment body"
    );

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "My comment body",
    });
  });

  it("propagates error when comment creation fails", async () => {
    const error = new Error("Unauthorized");
    asMock(mockOctokit.rest.issues.createComment).mockRejectedValue(error);

    await expect(
      addPRComment(mockOctokit, "owner", "repo", 42, "test")
    ).rejects.toThrow("Unauthorized");
  });

  it("handles missing body in response", async () => {
    asMock(mockOctokit.rest.issues.createComment).mockResolvedValue({
      data: {
        id: 1000,
        body: null,
        user: { login: "test-user" },
        created_at: "2026-01-16T15:00:00Z",
      },
    });

    const result = await addPRComment(
      mockOctokit,
      "owner",
      "repo",
      42,
      "test"
    );

    expect(result.body).toBe("");
  });
});

describe("mergePullRequest", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        pulls: {
          merge: vi.fn().mockResolvedValue({
            data: {
              sha: "abc123def456",
              merged: true,
            },
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns correct merge result on success", async () => {
    const result = await mergePullRequest(
      mockOctokit,
      "test-owner",
      "test-repo",
      42
    );

    expect(result).toEqual({
      sha: "abc123def456",
      merged: true,
    });
  });

  it("calls pulls.merge with correct parameters", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 123);

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 123,
      merge_method: "squash",
    });
  });

  it("defaults to squash merge method", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 42);

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        merge_method: "squash",
      })
    );
  });

  it("uses custom merge method when provided", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 42, {
      mergeMethod: "rebase",
    });

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        merge_method: "rebase",
      })
    );
  });

  it("includes commit title when provided", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 42, {
      commitTitle: "Custom merge title",
    });

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        commit_title: "Custom merge title",
      })
    );
  });

  it("includes commit message when provided", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 42, {
      commitMessage: "Custom merge message with details",
    });

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        commit_message: "Custom merge message with details",
      })
    );
  });

  it("includes both title and message when provided", async () => {
    await mergePullRequest(mockOctokit, "owner", "repo", 42, {
      mergeMethod: "squash",
      commitTitle: "feat: Add new feature",
      commitMessage: "Detailed description of the change",
    });

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 42,
      merge_method: "squash",
      commit_title: "feat: Add new feature",
      commit_message: "Detailed description of the change",
    });
  });

  it("propagates error when merge fails", async () => {
    const error = new Error("Pull request is not mergeable");
    asMock(mockOctokit.rest.pulls.merge).mockRejectedValue(error);

    await expect(
      mergePullRequest(mockOctokit, "owner", "repo", 42)
    ).rejects.toThrow("Pull request is not mergeable");
  });

  it("propagates error on conflicts", async () => {
    const error = new Error("Head branch was modified");
    asMock(mockOctokit.rest.pulls.merge).mockRejectedValue(error);

    await expect(
      mergePullRequest(mockOctokit, "owner", "repo", 42)
    ).rejects.toThrow("Head branch was modified");
  });
});
