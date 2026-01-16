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
 *   createCommit,
 *   createPullRequest,
 * } from './integrations/github';
 *
 * // Create client with config
 * const octokit = createGitHubClient({ token: process.env.GITHUB_TOKEN });
 *
 * // Or create directly with token
 * const octokit = getOctokit(process.env.GITHUB_TOKEN);
 *
 * // Branch operations
 * const newBranch = await createBranch(octokit, {
 *   owner: 'owner',
 *   repo: 'repo',
 *   branchName: 'feature/new-feature',
 *   baseBranch: 'main',
 * });
 *
 * // Commit changes
 * const commit = await createCommit(octokit, {
 *   owner: 'owner',
 *   repo: 'repo',
 *   branch: 'feature/new-feature',
 *   message: 'Add new feature',
 *   files: [{ path: 'src/feature.ts', content: 'export const x = 1;' }],
 * });
 *
 * // Open pull request
 * const pr = await createPullRequest(octokit, {
 *   owner: 'owner',
 *   repo: 'repo',
 *   title: 'Add new feature',
 *   body: 'This PR adds a new feature',
 *   head: 'feature/new-feature',
 *   base: 'main',
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
  PRComment,
} from "./types.js";

// Client factory
export { createGitHubClient, getOctokit } from "./client.js";

// Branch operations
export { getBranch, listBranches, createBranch } from "./branches.js";

// Commit operations
export { createCommit } from "./commits.js";

// Pull request operations
export {
  createPullRequest,
  getPullRequest,
  listPRComments,
  addPRComment,
  mergePullRequest,
} from "./pull-requests.js";
