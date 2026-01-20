/**
 * GitHub Branch Operations Tests
 *
 * Tests for branch operations (get, list, create).
 * Uses mocked Octokit to verify correct API calls.
 */

import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createBranch, getBranch, listBranches } from "./branches.js";

// Helper to get mock from Octokit methods
function asMock<T>(fn: T): Mock {
  return fn as unknown as Mock;
}

describe("getBranch", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({
            data: {
              ref: "refs/heads/main",
              object: {
                sha: "abc123def456",
                type: "commit",
              },
            },
          }),
          createRef: vi.fn(),
        },
        repos: {
          listBranches: vi.fn(),
        },
      },
    } as unknown as Octokit;
  });

  it("returns branch info with name and SHA", async () => {
    const result = await getBranch(mockOctokit, "owner", "repo", "main");

    expect(result).toEqual({
      name: "main",
      sha: "abc123def456",
      protected: false,
    });
  });

  it("calls getRef with correct parameters", async () => {
    await getBranch(mockOctokit, "test-owner", "test-repo", "feature-branch");

    expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "heads/feature-branch",
    });
  });

  it("propagates errors from getRef", async () => {
    const error = new Error("Not found");
    asMock(mockOctokit.rest.git.getRef).mockRejectedValue(error);

    await expect(
      getBranch(mockOctokit, "owner", "repo", "nonexistent"),
    ).rejects.toThrow("Not found");
  });
});

describe("listBranches", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        git: {
          getRef: vi.fn(),
          createRef: vi.fn(),
        },
        repos: {
          listBranches: vi.fn().mockResolvedValue({
            data: [
              {
                name: "main",
                commit: { sha: "sha1" },
                protected: true,
              },
              {
                name: "develop",
                commit: { sha: "sha2" },
                protected: false,
              },
              {
                name: "feature/new-thing",
                commit: { sha: "sha3" },
                protected: false,
              },
            ],
          }),
        },
      },
    } as unknown as Octokit;
  });

  it("returns array of branch info", async () => {
    const result = await listBranches(mockOctokit, "owner", "repo");

    expect(result).toEqual([
      { name: "main", sha: "sha1", protected: true },
      { name: "develop", sha: "sha2", protected: false },
      { name: "feature/new-thing", sha: "sha3", protected: false },
    ]);
  });

  it("calls listBranches with correct parameters", async () => {
    await listBranches(mockOctokit, "test-owner", "test-repo");

    expect(mockOctokit.rest.repos.listBranches).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
    });
  });

  it("returns empty array for repo with no branches", async () => {
    asMock(mockOctokit.rest.repos.listBranches).mockResolvedValue({
      data: [],
    });

    const result = await listBranches(mockOctokit, "owner", "repo");

    expect(result).toEqual([]);
  });
});

describe("createBranch", () => {
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({
            data: {
              ref: "refs/heads/main",
              object: {
                sha: "base-sha-123",
                type: "commit",
              },
            },
          }),
          createRef: vi.fn().mockResolvedValue({
            data: {
              ref: "refs/heads/feature/new-branch",
              object: {
                sha: "base-sha-123",
                type: "commit",
              },
            },
          }),
        },
        repos: {
          listBranches: vi.fn(),
        },
      },
    } as unknown as Octokit;
  });

  it("creates branch from base branch SHA", async () => {
    const result = await createBranch(mockOctokit, {
      owner: "owner",
      repo: "repo",
      branchName: "feature/new-branch",
      baseBranch: "main",
    });

    expect(result).toEqual({
      name: "feature/new-branch",
      sha: "base-sha-123",
      protected: false,
    });
  });

  it("calls getRef to get base branch SHA", async () => {
    await createBranch(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branchName: "feature/test",
      baseBranch: "develop",
    });

    expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "heads/develop",
    });
  });

  it("calls createRef with correct parameters", async () => {
    await createBranch(mockOctokit, {
      owner: "test-owner",
      repo: "test-repo",
      branchName: "feature/awesome",
      baseBranch: "main",
    });

    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      ref: "refs/heads/feature/awesome",
      sha: "base-sha-123",
    });
  });

  it("uses main as default base branch", async () => {
    await createBranch(mockOctokit, {
      owner: "owner",
      repo: "repo",
      branchName: "hotfix/fix",
    });

    expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/main",
    });
  });

  it("propagates error when base branch not found", async () => {
    const error = new Error("Base branch not found");
    asMock(mockOctokit.rest.git.getRef).mockRejectedValue(error);

    await expect(
      createBranch(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branchName: "feature/test",
        baseBranch: "nonexistent",
      }),
    ).rejects.toThrow("Base branch not found");
  });

  it("propagates error when createRef fails", async () => {
    const error = new Error("Branch already exists");
    asMock(mockOctokit.rest.git.createRef).mockRejectedValue(error);

    await expect(
      createBranch(mockOctokit, {
        owner: "owner",
        repo: "repo",
        branchName: "main", // Already exists
        baseBranch: "main",
      }),
    ).rejects.toThrow("Branch already exists");
  });
});
