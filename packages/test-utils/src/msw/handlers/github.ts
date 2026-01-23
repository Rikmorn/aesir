/**
 * MSW handlers for GitHub REST API
 *
 * Mocks GitHub's REST API endpoints for testing integration code
 * without hitting the real API.
 */
import { HttpResponse, http } from "msw";

/** GitHub REST API base URL */
const GITHUB_API = "https://api.github.com";

/**
 * Mock repository data matching Octokit types
 */
const mockRepository = {
  id: 123456789,
  node_id: "R_kgDOBxxxxx",
  name: "test-repo",
  full_name: "test-org/test-repo",
  private: false,
  owner: {
    login: "test-org",
    id: 12345,
    type: "Organization",
  },
  html_url: "https://github.com/test-org/test-repo",
  description: "A test repository",
  default_branch: "main",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  pushed_at: "2026-01-01T00:00:00Z",
};

/**
 * Mock pull request data
 */
const mockPullRequest = {
  id: 987654321,
  number: 42,
  state: "open",
  title: "Mock Pull Request",
  body: "This is a mock PR for testing",
  user: {
    login: "test-user",
    id: 54321,
  },
  head: {
    ref: "feature-branch",
    sha: "abc123def456",
  },
  base: {
    ref: "main",
    sha: "000111222333",
  },
  html_url: "https://github.com/test-org/test-repo/pull/42",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  merged_at: null,
  merge_commit_sha: null,
  mergeable: true,
  mergeable_state: "clean",
};

/**
 * Mock branch data
 */
const mockBranch = {
  name: "main",
  commit: {
    sha: "abc123def456789",
    url: "https://api.github.com/repos/test-org/test-repo/commits/abc123def456789",
  },
  protected: true,
};

/**
 * Mock file content data
 */
const mockFileContent = {
  type: "file",
  encoding: "base64",
  size: 100,
  name: "README.md",
  path: "README.md",
  content: Buffer.from("# Test Repository\n\nThis is a test.").toString(
    "base64",
  ),
  sha: "file_sha_123",
};

/**
 * Mock commit data
 */
const mockCommit = {
  sha: "commit_sha_123456",
  node_id: "C_kwDOBxxxxx",
  commit: {
    message: "Mock commit message",
    tree: {
      sha: "tree_sha_123",
    },
    author: {
      name: "Test User",
      email: "test@example.com",
      date: "2026-01-01T00:00:00Z",
    },
  },
  html_url: "https://github.com/test-org/test-repo/commit/commit_sha_123456",
};

/**
 * Mock reference data
 */
const mockRef = {
  ref: "refs/heads/feature-branch",
  node_id: "REF_kwDOBxxxxx",
  url: "https://api.github.com/repos/test-org/test-repo/git/refs/heads/feature-branch",
  object: {
    type: "commit",
    sha: "abc123def456789",
  },
};

/**
 * Default MSW handlers for GitHub REST API
 *
 * Usage:
 * ```ts
 * import { githubHandlers } from "@aesir/test-utils";
 * import { setupServer } from "msw/node";
 *
 * const server = setupServer(...githubHandlers);
 * ```
 */
export const githubHandlers = [
  // Repository endpoints
  http.get(`${GITHUB_API}/repos/:owner/:repo`, () => {
    return HttpResponse.json(mockRepository);
  }),

  // Pull request endpoints
  http.get(`${GITHUB_API}/repos/:owner/:repo/pulls`, () => {
    return HttpResponse.json([mockPullRequest]);
  }),

  http.get(`${GITHUB_API}/repos/:owner/:repo/pulls/:pull_number`, () => {
    return HttpResponse.json(mockPullRequest);
  }),

  http.post(`${GITHUB_API}/repos/:owner/:repo/pulls`, async ({ request }) => {
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      head?: string;
      base?: string;
    };
    return HttpResponse.json(
      {
        ...mockPullRequest,
        number: Math.floor(Math.random() * 1000),
        title: body.title || mockPullRequest.title,
        body: body.body || mockPullRequest.body,
        head: {
          ...mockPullRequest.head,
          ref: body.head || mockPullRequest.head.ref,
        },
        base: {
          ...mockPullRequest.base,
          ref: body.base || mockPullRequest.base.ref,
        },
      },
      { status: 201 },
    );
  }),

  http.put(`${GITHUB_API}/repos/:owner/:repo/pulls/:pull_number/merge`, () => {
    return HttpResponse.json({
      sha: "merge_commit_sha_123",
      merged: true,
      message: "Pull Request successfully merged",
    });
  }),

  // Branch/Reference endpoints
  http.get(`${GITHUB_API}/repos/:owner/:repo/branches/:branch`, () => {
    return HttpResponse.json(mockBranch);
  }),

  http.get(`${GITHUB_API}/repos/:owner/:repo/git/ref/:ref`, () => {
    return HttpResponse.json(mockRef);
  }),

  http.post(
    `${GITHUB_API}/repos/:owner/:repo/git/refs`,
    async ({ request }) => {
      const body = (await request.json()) as { ref?: string; sha?: string };
      return HttpResponse.json(
        {
          ...mockRef,
          ref: body.ref || mockRef.ref,
          object: {
            ...mockRef.object,
            sha: body.sha || mockRef.object.sha,
          },
        },
        { status: 201 },
      );
    },
  ),

  http.patch(
    `${GITHUB_API}/repos/:owner/:repo/git/refs/:ref`,
    async ({ request }) => {
      const body = (await request.json()) as { sha?: string };
      return HttpResponse.json({
        ...mockRef,
        object: {
          ...mockRef.object,
          sha: body.sha || mockRef.object.sha,
        },
      });
    },
  ),

  // Content endpoints
  http.get(`${GITHUB_API}/repos/:owner/:repo/contents/:path`, () => {
    return HttpResponse.json(mockFileContent);
  }),

  http.put(
    `${GITHUB_API}/repos/:owner/:repo/contents/:path`,
    async ({ request }) => {
      const body = (await request.json()) as {
        message?: string;
        content?: string;
        sha?: string;
        branch?: string;
      };
      return HttpResponse.json({
        content: {
          ...mockFileContent,
          sha: `new_sha_${Date.now()}`,
        },
        commit: {
          ...mockCommit,
          commit: {
            ...mockCommit.commit,
            message: body.message || mockCommit.commit.message,
          },
        },
      });
    },
  ),

  // Commit endpoints
  http.get(`${GITHUB_API}/repos/:owner/:repo/commits/:ref`, () => {
    return HttpResponse.json(mockCommit);
  }),

  http.post(
    `${GITHUB_API}/repos/:owner/:repo/git/commits`,
    async ({ request }) => {
      const body = (await request.json()) as {
        message?: string;
        tree?: string;
        parents?: string[];
      };
      return HttpResponse.json(
        {
          ...mockCommit,
          sha: `new_commit_${Date.now()}`,
          commit: {
            ...mockCommit.commit,
            message: body.message || mockCommit.commit.message,
            tree: {
              sha: body.tree || mockCommit.commit.tree.sha,
            },
          },
        },
        { status: 201 },
      );
    },
  ),

  // Tree endpoints
  http.post(
    `${GITHUB_API}/repos/:owner/:repo/git/trees`,
    async ({ request }) => {
      const body = (await request.json()) as {
        tree?: unknown[];
        base_tree?: string;
      };
      return HttpResponse.json(
        {
          sha: `tree_sha_${Date.now()}`,
          url: "https://api.github.com/repos/test-org/test-repo/git/trees/tree_sha",
          tree: body.tree || [],
        },
        { status: 201 },
      );
    },
  ),
];

/**
 * Mock data exports for test assertions
 */
export const githubMockData = {
  repository: mockRepository,
  pullRequest: mockPullRequest,
  branch: mockBranch,
  fileContent: mockFileContent,
  commit: mockCommit,
  ref: mockRef,
};
