/**
 * GitHub Commit Operations Tests
 *
 * Tests for commit operations using the Git Data API.
 * Uses mocked Octokit to verify correct API call sequence.
 */

import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createCommit } from "./commits.js";

// Helper to get mock from Octokit methods
function asMock<T>(fn: T): Mock {
  return fn as unknown as Mock;
}

describe("createCommit", () => {
  let mockOctokit: Octokit;

  const mockParentSha = "parent-sha-abc123";
  const mockTreeSha = "base-tree-sha-def456";
  const mockNewTreeSha = "new-tree-sha-ghi789";
  const mockCommitSha = "commit-sha-jkl012";

  beforeEach(() => {
    mockOctokit = {
      rest: {
        git: {
          // getBranch uses getRef internally
          getRef: vi.fn().mockResolvedValue({
            data: {
              ref: "refs/heads/feature-branch",
              object: {
                sha: mockParentSha,
                type: "commit",
              },
            },
          }),
          getCommit: vi.fn().mockResolvedValue({
            data: {
              sha: mockParentSha,
              tree: {
                sha: mockTreeSha,
              },
              message: "Previous commit",
              author: {
                name: "Test Author",
                email: "test@example.com",
                date: "2026-01-15T10:00:00Z",
              },
            },
          }),
          createTree: vi.fn().mockResolvedValue({
            data: {
              sha: mockNewTreeSha,
            },
          }),
          createCommit: vi.fn().mockResolvedValue({
            data: {
              sha: mockCommitSha,
              message: "Add new feature",
              author: {
                name: "Agent",
                email: "agent@example.com",
                date: "2026-01-16T12:00:00Z",
              },
            },
          }),
          updateRef: vi.fn().mockResolvedValue({
            data: {
              ref: "refs/heads/feature-branch",
              object: {
                sha: mockCommitSha,
              },
            },
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns correct CommitInfo on success", async () => {
    const result = await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature-branch",
      message: "Add new feature",
      files: [{ path: "src/index.ts", content: "console.log('hello');" }],
    });

    expect(result).toEqual({
      sha: mockCommitSha,
      message: "Add new feature",
      author: {
        name: "Agent",
        email: "agent@example.com",
        date: "2026-01-16T12:00:00Z",
      },
    });
  });

  it("calls getBranch (getRef) to get current SHA", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "main",
      message: "Update file",
      files: [{ path: "README.md", content: "# Test" }],
    });

    expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "heads/main",
    });
  });

  it("calls getCommit to get base tree SHA", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature-branch",
      message: "Add feature",
      files: [{ path: "src/feature.ts", content: "export const x = 1;" }],
    });

    expect(mockOctokit.rest.git.getCommit).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      commit_sha: mockParentSha,
    });
  });

  it("calls createTree with file changes", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature-branch",
      message: "Add multiple files",
      files: [
        { path: "src/a.ts", content: "export const a = 1;" },
        { path: "src/b.ts", content: "export const b = 2;" },
      ],
    });

    expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      base_tree: mockTreeSha,
      tree: [
        {
          path: "src/a.ts",
          mode: "100644",
          type: "blob",
          content: "export const a = 1;",
        },
        {
          path: "src/b.ts",
          mode: "100644",
          type: "blob",
          content: "export const b = 2;",
        },
      ],
    });
  });

  it("calls createCommit with tree SHA and parent", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature-branch",
      message: "My commit message",
      files: [{ path: "file.txt", content: "content" }],
    });

    expect(mockOctokit.rest.git.createCommit).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      message: "My commit message",
      tree: mockNewTreeSha,
      parents: [mockParentSha],
    });
  });

  it("calls updateRef to advance branch", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "feature-branch",
      message: "Update branch",
      files: [{ path: "update.txt", content: "updated" }],
    });

    expect(mockOctokit.rest.git.updateRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "heads/feature-branch",
      sha: mockCommitSha,
    });
  });

  it("respects custom file mode", async () => {
    await createCommit(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branch: "main",
      message: "Add executable",
      files: [
        {
          path: "scripts/run.sh",
          content: "#!/bin/bash\necho hello",
          mode: "100755",
        },
      ],
    });

    expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        tree: [
          {
            path: "scripts/run.sh",
            mode: "100755",
            type: "blob",
            content: "#!/bin/bash\necho hello",
          },
        ],
      }),
    );
  });

  it("propagates error when branch not found", async () => {
    const error = new Error("Branch not found");
    asMock(mockOctokit.rest.git.getRef).mockRejectedValue(error);

    await expect(
      createCommit(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branch: "nonexistent",
        message: "Test",
        files: [{ path: "file.txt", content: "test" }],
      }),
    ).rejects.toThrow("Branch not found");
  });

  it("propagates error when createTree fails", async () => {
    const error = new Error("Tree creation failed");
    asMock(mockOctokit.rest.git.createTree).mockRejectedValue(error);

    await expect(
      createCommit(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        message: "Test",
        files: [{ path: "file.txt", content: "test" }],
      }),
    ).rejects.toThrow("Tree creation failed");
  });

  it("propagates error when createCommit fails", async () => {
    const error = new Error("Commit creation failed");
    asMock(mockOctokit.rest.git.createCommit).mockRejectedValue(error);

    await expect(
      createCommit(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        message: "Test",
        files: [{ path: "file.txt", content: "test" }],
      }),
    ).rejects.toThrow("Commit creation failed");
  });

  it("propagates error when updateRef fails", async () => {
    const error = new Error("Reference update failed");
    asMock(mockOctokit.rest.git.updateRef).mockRejectedValue(error);

    await expect(
      createCommit(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        message: "Test",
        files: [{ path: "file.txt", content: "test" }],
      }),
    ).rejects.toThrow("Reference update failed");
  });

  it("handles missing author info gracefully", async () => {
    asMock(mockOctokit.rest.git.createCommit).mockResolvedValue({
      data: {
        sha: mockCommitSha,
        message: "Add feature",
        author: null,
      },
    });

    const result = await createCommit(mockOctokit, {
      owner: "owner",
      repo: "repo",
      branch: "main",
      message: "Add feature",
      files: [{ path: "file.txt", content: "test" }],
    });

    expect(result.author.name).toBe("Unknown");
    expect(result.author.email).toBe("unknown@example.com");
  });
});
