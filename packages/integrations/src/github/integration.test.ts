/**
 * GitHub Integration Test
 *
 * Demonstrates the complete workflow: branch → commit → PR → feedback loop.
 * Tests that all components work together correctly.
 */

import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPRComment,
  createBranch,
  createCommit,
  createPullRequest,
  getPullRequest,
  listPRComments,
} from "./index.js";

// Create a fully mocked Octokit instance for integration testing
function createMockOctokit() {
  return {
    rest: {
      git: {
        // getBranch uses getRef
        getRef: vi.fn(),
        // createBranch uses createRef
        createRef: vi.fn(),
        // createCommit flow
        getCommit: vi.fn(),
        createTree: vi.fn(),
        createCommit: vi.fn(),
        updateRef: vi.fn(),
      },
      repos: {
        listBranches: vi.fn(),
      },
      pulls: {
        create: vi.fn(),
        get: vi.fn(),
        listReviewComments: vi.fn(),
      },
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(),
      },
    },
  } as unknown as Octokit;
}

describe("GitHub Integration - Complete Branch to PR Workflow", () => {
  let mockOctokit: Octokit;
  const owner = "test-owner";
  const repo = "test-repo";

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    vi.clearAllMocks();
  });

  it("should create branch, commit, and open PR", async () => {
    // Setup mocks for the complete workflow

    // 1. createBranch needs getRef (to get base branch SHA) and createRef
    vi.mocked(mockOctokit.rest.git.getRef)
      .mockResolvedValueOnce({
        // First call: get main branch SHA for base
        data: {
          ref: "refs/heads/main",
          object: { sha: "main-sha-abc123", type: "commit" },
        },
      } as never)
      .mockResolvedValueOnce({
        // Second call: get new branch SHA for createCommit
        data: {
          ref: "refs/heads/feature/test",
          object: { sha: "main-sha-abc123", type: "commit" },
        },
      } as never);

    vi.mocked(mockOctokit.rest.git.createRef).mockResolvedValue({
      data: {
        ref: "refs/heads/feature/test",
        object: { sha: "main-sha-abc123", type: "commit" },
      },
    } as never);

    // 2. createCommit needs getCommit, createTree, createCommit, updateRef
    vi.mocked(mockOctokit.rest.git.getCommit).mockResolvedValue({
      data: {
        sha: "main-sha-abc123",
        tree: { sha: "base-tree-sha" },
        message: "Initial commit",
        author: {
          name: "Test",
          email: "test@test.com",
          date: "2026-01-15T00:00:00Z",
        },
      },
    } as never);

    vi.mocked(mockOctokit.rest.git.createTree).mockResolvedValue({
      data: { sha: "new-tree-sha" },
    } as never);

    vi.mocked(mockOctokit.rest.git.createCommit).mockResolvedValue({
      data: {
        sha: "new-commit-sha-def456",
        message: "Add login feature",
        author: {
          name: "Agent",
          email: "agent@example.com",
          date: "2026-01-16T10:00:00Z",
        },
      },
    } as never);

    vi.mocked(mockOctokit.rest.git.updateRef).mockResolvedValue({
      data: {
        ref: "refs/heads/feature/test",
        object: { sha: "new-commit-sha-def456" },
      },
    } as never);

    // 3. createPullRequest needs pulls.create
    vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({
      data: {
        number: 42,
        title: "Add login feature",
        body: "This PR implements login",
        state: "open",
        head: { ref: "feature/test" },
        base: { ref: "main" },
        html_url: "https://github.com/test-owner/test-repo/pull/42",
      },
    } as never);

    // Execute the workflow
    // Step 1: Create branch
    const branch = await createBranch(mockOctokit, {
      owner,
      repo,
      branchName: "feature/test",
      baseBranch: "main",
    });

    expect(branch.name).toBe("feature/test");
    expect(branch.sha).toBe("main-sha-abc123");

    // Step 2: Create commit
    const commit = await createCommit(mockOctokit, {
      owner,
      repo,
      branch: "feature/test",
      message: "Add login feature",
      files: [
        { path: "src/auth/login.ts", content: "export function login() {}" },
        { path: "src/auth/login.test.ts", content: "test('login', () => {})" },
      ],
    });

    expect(commit.sha).toBe("new-commit-sha-def456");
    expect(commit.message).toBe("Add login feature");

    // Verify createTree was called with our files
    expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith({
      owner,
      repo,
      base_tree: "base-tree-sha",
      tree: [
        {
          path: "src/auth/login.ts",
          mode: "100644",
          type: "blob",
          content: "export function login() {}",
        },
        {
          path: "src/auth/login.test.ts",
          mode: "100644",
          type: "blob",
          content: "test('login', () => {})",
        },
      ],
    });

    // Step 3: Create PR
    const pr = await createPullRequest(mockOctokit, {
      owner,
      repo,
      title: "Add login feature",
      body: "This PR implements login",
      head: "feature/test",
      base: "main",
    });

    expect(pr.number).toBe(42);
    expect(pr.url).toBe("https://github.com/test-owner/test-repo/pull/42");

    // Verify the complete API call sequence
    expect(mockOctokit.rest.git.getRef).toHaveBeenCalledTimes(2); // For branch and commit
    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledTimes(1);
    expect(mockOctokit.rest.git.createCommit).toHaveBeenCalledTimes(1);
    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledTimes(1);
  });

  it("should read and respond to PR comments", async () => {
    // Setup mocks for PR feedback workflow

    // getPullRequest
    vi.mocked(mockOctokit.rest.pulls.get).mockResolvedValue({
      data: {
        number: 123,
        title: "Fix bug in parser",
        body: "This fixes the parsing issue",
        state: "open",
        head: { ref: "fix/parser-bug" },
        base: { ref: "main" },
        html_url: "https://github.com/test-owner/test-repo/pull/123",
      },
    } as never);

    // listPRComments - review and issue comments
    vi.mocked(mockOctokit.rest.pulls.listReviewComments).mockResolvedValue({
      data: [
        {
          id: 1,
          body: "This line could be simplified",
          user: { login: "reviewer" },
          created_at: "2026-01-15T10:00:00Z",
          path: "src/parser.ts",
        },
      ],
    } as never);

    vi.mocked(mockOctokit.rest.issues.listComments).mockResolvedValue({
      data: [
        {
          id: 100,
          body: "Please also add tests",
          user: { login: "maintainer" },
          created_at: "2026-01-15T11:00:00Z",
        },
      ],
    } as never);

    // addPRComment
    vi.mocked(mockOctokit.rest.issues.createComment).mockResolvedValue({
      data: {
        id: 200,
        body: "Thanks for the feedback! I'll simplify that line and add tests.",
        user: { login: "agent-bot" },
        created_at: "2026-01-15T12:00:00Z",
      },
    } as never);

    // Execute PR feedback workflow
    // Step 1: Get PR info
    const pr = await getPullRequest(mockOctokit, owner, repo, 123);

    expect(pr.number).toBe(123);
    expect(pr.title).toBe("Fix bug in parser");
    expect(pr.state).toBe("open");

    // Step 2: Read comments
    const comments = await listPRComments(mockOctokit, owner, repo, 123);

    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toBe("This line could be simplified");
    expect(comments[0]?.path).toBe("src/parser.ts"); // Review comment has path
    expect(comments[1]?.body).toBe("Please also add tests");
    expect(comments[1]?.path).toBeUndefined(); // Issue comment has no path

    // Step 3: Respond to feedback
    const response = await addPRComment(
      mockOctokit,
      owner,
      repo,
      123,
      "Thanks for the feedback! I'll simplify that line and add tests.",
    );

    expect(response.id).toBe(200);
    expect(response.body).toContain("Thanks for the feedback");

    // Verify API calls
    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: 123,
    });
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: 123,
      body: "Thanks for the feedback! I'll simplify that line and add tests.",
    });
  });
});

describe("Module Exports", () => {
  it("should export all required functions and types", async () => {
    const exports = await import("./index.js");

    // Client factory
    expect(typeof exports.createGitHubClient).toBe("function");
    expect(typeof exports.getOctokit).toBe("function");

    // Branch operations
    expect(typeof exports.getBranch).toBe("function");
    expect(typeof exports.listBranches).toBe("function");
    expect(typeof exports.createBranch).toBe("function");

    // Commit operations
    expect(typeof exports.createCommit).toBe("function");

    // Pull request operations
    expect(typeof exports.createPullRequest).toBe("function");
    expect(typeof exports.getPullRequest).toBe("function");
    expect(typeof exports.listPRComments).toBe("function");
    expect(typeof exports.addPRComment).toBe("function");
  });
});
