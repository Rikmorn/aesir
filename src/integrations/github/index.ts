/**
 * GitHub Integration Module
 *
 * Provides Octokit client factory and GitHub operations
 * for branches, commits, and pull requests.
 *
 * @example
 * ```typescript
 * import {
 *   createGitHubClient,
 *   getOctokit,
 *   getBranch,
 *   createBranch,
 *   listBranches,
 * } from './integrations/github';
 *
 * // Create client with config
 * const octokit = createGitHubClient({ token: process.env.GITHUB_TOKEN });
 *
 * // Or create directly with token
 * const octokit = getOctokit(process.env.GITHUB_TOKEN);
 *
 * // Branch operations
 * const branch = await getBranch(octokit, 'owner', 'repo', 'main');
 * const branches = await listBranches(octokit, 'owner', 'repo');
 * const newBranch = await createBranch(octokit, {
 *   owner: 'owner',
 *   repo: 'repo',
 *   branchName: 'feature/new-feature',
 *   baseBranch: 'main',
 * });
 * ```
 */

// Types
export type {
  GitHubConfig,
  BranchInfo,
  CreateBranchOptions,
  CommitInfo,
  FileChange,
  CreateCommitOptions,
  PullRequestInfo,
  CreatePROptions,
} from "./types.js";

// Client factory
export { createGitHubClient, getOctokit } from "./client.js";

// Branch operations
export { getBranch, listBranches, createBranch } from "./branches.js";
