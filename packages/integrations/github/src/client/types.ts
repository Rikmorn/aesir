/**
 * GitHub Integration Types
 *
 * Type definitions for GitHub API configuration, branch operations,
 * commits, and pull requests. These types support the agent's
 * interaction with GitHub's REST API via Octokit.
 */

/**
 * Configuration for GitHub API access
 */
export interface GitHubConfig {
  /** Personal access token or GitHub App token for API calls */
  token: string;
}

/**
 * Information about a Git branch
 */
export interface BranchInfo {
  /** Branch name (e.g., "main", "feature/add-auth") */
  name: string;
  /** SHA of the commit at the tip of the branch */
  sha: string;
  /** Whether the branch is protected */
  protected: boolean;
}

/**
 * Options for creating a new branch
 */
export interface CreateBranchOptions {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Name for the new branch */
  branchName: string;
  /** Base branch to create from (default: 'main') */
  baseBranch?: string;
}

/**
 * Information about a Git commit
 */
export interface CommitInfo {
  /** Full SHA hash of the commit */
  sha: string;
  /** Commit message */
  message: string;
  /** Author information */
  author: {
    /** Author name */
    name: string;
    /** Author email */
    email: string;
    /** Commit date (ISO 8601 format) */
    date: string;
  };
}

/**
 * Represents a file change in a commit
 */
export interface FileChange {
  /** Path to the file relative to repository root */
  path: string;
  /** File content (UTF-8 encoded) */
  content: string;
  /** File mode (default: '100644' for regular file) */
  mode?: "100644" | "100755" | "040000" | "160000" | "120000";
}

/**
 * Options for creating a commit with file changes
 */
export interface CreateCommitOptions {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Branch to commit to */
  branch: string;
  /** Commit message */
  message: string;
  /** Files to add/modify in the commit */
  files: FileChange[];
}

/**
 * Information about a pull request
 */
export interface PullRequestInfo {
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR body/description */
  body: string | null;
  /** PR state */
  state: "open" | "closed";
  /** Head branch name */
  headBranch: string;
  /** Base branch name */
  baseBranch: string;
  /** Full URL to the PR */
  url: string;
}

/**
 * Options for creating a pull request
 */
export interface CreatePROptions {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** PR title */
  title: string;
  /** PR body/description */
  body?: string;
  /** Head branch (the branch with changes) */
  head: string;
  /** Base branch (the branch to merge into) */
  base: string;
}

/**
 * A comment on a pull request
 *
 * Represents both review comments (on specific lines of code)
 * and issue comments (in the conversation thread).
 */
export interface PRComment {
  /** Comment ID */
  id: number;
  /** Comment body/content */
  body: string;
  /** Username of the commenter */
  user: string;
  /** When the comment was created (ISO 8601 format) */
  createdAt: string;
  /** File path for review comments (undefined for issue comments) */
  path?: string;
}
