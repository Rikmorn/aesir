/**
 * GitHub Integration Tools
 *
 * ToolDefinition factories for the 9 GitHub MCP tools.
 * All Zod schemas are defined locally -- no imports from @aesir/integration-github.
 *
 * Tools are prefixed with "github_" to namespace them for the LLM
 * and avoid collisions with other integration tools.
 */

import { z } from "zod";
import type { ToolDefinition } from "../../agent-loop/types.js";
import { createMcpToolWrapper, type McpToolDeps } from "./mcp-wrapper.js";

// ---------------------------------------------------------------------------
// Input Schemas (locally defined, not imported from integration package)
// ---------------------------------------------------------------------------

const getRepositorySchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
});

const createBranchSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  branchName: z.string().describe("Name for the new branch"),
  baseBranch: z
    .string()
    .optional()
    .describe("Branch to create from (defaults to default branch)"),
});

const createCommitSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  branch: z.string().describe("Branch to commit to"),
  message: z.string().describe("Commit message"),
  files: z
    .array(
      z.object({
        path: z.string().describe("File path relative to repository root"),
        content: z.string().describe("File content (UTF-8 text)"),
      }),
    )
    .describe("Files to include in the commit"),
});

const createPullRequestSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  title: z.string().describe("Pull request title"),
  body: z.string().optional().describe("Pull request description (Markdown)"),
  head: z.string().describe("Branch containing the changes"),
  base: z.string().describe("Branch to merge into"),
});

const getPullRequestSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  pullNumber: z.number().describe("Pull request number"),
});

const listPullRequestsSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  state: z
    .enum(["open", "closed", "all"])
    .optional()
    .describe("Filter by PR state (defaults to 'open')"),
});

const mergePullRequestSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  pullNumber: z.number().describe("Pull request number to merge"),
  mergeMethod: z
    .enum(["merge", "squash", "rebase"])
    .optional()
    .describe("Merge strategy (defaults to repository setting)"),
  commitTitle: z
    .string()
    .optional()
    .describe("Custom merge commit title (squash/merge only)"),
  commitMessage: z
    .string()
    .optional()
    .describe("Custom merge commit message (squash/merge only)"),
});

const getFileContentsSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("File path relative to repository root"),
  ref: z
    .string()
    .optional()
    .describe("Git ref (branch, tag, or SHA) to read from"),
});

const listFilesSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  path: z
    .string()
    .optional()
    .describe("Directory path to list (defaults to repository root)"),
  ref: z
    .string()
    .optional()
    .describe("Git ref (branch, tag, or SHA) to list from"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all GitHub MCP tool definitions.
 *
 * Returns 9 tools for interacting with GitHub via the MCP layer:
 * get_repository, create_branch, create_commit, create_pull_request,
 * get_pull_request, list_pull_requests, merge_pull_request,
 * get_file_contents, list_files.
 *
 * @param deps - Agent ID and correlation ID for MCP calls
 * @returns Array of 9 ToolDefinition objects
 */
export function createGitHubTools(deps: McpToolDeps): ToolDefinition[] {
  return [
    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "get_repository",
        displayName: "github_get_repository",
        description:
          "Get information about a GitHub repository including its default branch, visibility, description, and language. Use this to understand the repository setup before performing operations like creating branches or reading files.",
        inputSchema: getRepositorySchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "create_branch",
        displayName: "github_create_branch",
        description:
          "Create a new branch in a GitHub repository. The branch is created from the base branch (or the default branch if not specified). Use this before making commits to isolate changes for a pull request.",
        inputSchema: createBranchSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "create_commit",
        displayName: "github_create_commit",
        description:
          "Create a commit with one or more file changes on a branch. Each file specifies a path and content. Use this to push code changes, configuration updates, or documentation to a branch. The commit is created via the GitHub API (no local git clone needed).",
        inputSchema: createCommitSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "create_pull_request",
        displayName: "github_create_pull_request",
        description:
          "Open a new pull request to merge changes from a head branch into a base branch. Include a descriptive title and body explaining the changes. Use this after committing code to a feature branch to request review and merge.",
        inputSchema: createPullRequestSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "get_pull_request",
        displayName: "github_get_pull_request",
        description:
          "Get details of a specific pull request by number. Returns title, body, status, review state, merge status, and changed files. Use this to check PR status, read review feedback, or verify merge readiness.",
        inputSchema: getPullRequestSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "list_pull_requests",
        displayName: "github_list_pull_requests",
        description:
          "List pull requests in a repository, optionally filtered by state (open, closed, or all). Returns PR numbers, titles, and basic metadata. Use this to find existing PRs or check for conflicts with in-progress work.",
        inputSchema: listPullRequestsSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "merge_pull_request",
        displayName: "github_merge_pull_request",
        description:
          "Merge an approved pull request using the specified merge method (merge commit, squash, or rebase). Use this after a PR has been reviewed and approved. Only merge PRs that have passing checks and approval.",
        inputSchema: mergePullRequestSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "get_file_contents",
        displayName: "github_get_file_contents",
        description:
          "Read the contents of a file from a GitHub repository at a specific ref (branch, tag, or SHA). Returns the file content as text. Use this to examine existing code, configuration, or documentation without cloning the repository.",
        inputSchema: getFileContentsSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "github",
        toolName: "list_files",
        displayName: "github_list_files",
        description:
          "List files and directories at a given path in a GitHub repository. Returns names and types (file or directory) for each entry. Use this to explore repository structure and discover files before reading them.",
        inputSchema: listFilesSchema,
      },
      deps,
    ),
  ];
}
