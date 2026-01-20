/**
 * GitHub Commit Operations
 *
 * Functions for creating commits in GitHub repositories.
 * Uses the Git Data API to create commits without needing a local working directory.
 */

import type { Octokit } from "@octokit/rest";
import { createLogger } from "../../logging/logger.js";
import { getBranch } from "./branches.js";
import type { CommitInfo, CreateCommitOptions } from "./types.js";

const logger = createLogger({ defaultContext: { module: "github-commits" } });

/**
 * Create a commit with file changes using the Git Data API
 *
 * This creates a commit programmatically without needing a git clone.
 * It uses the Git Data API to:
 * 1. Get current commit SHA from branch
 * 2. Get base tree SHA
 * 3. Create a new tree with file changes
 * 4. Create a commit pointing to the new tree
 * 5. Update the branch reference to the new commit
 *
 * @param octokit - Authenticated Octokit instance
 * @param options - Commit creation options
 * @returns Information about the created commit
 * @throws Error if branch not found or commit creation fails
 */
export async function createCommit(
  octokit: Octokit,
  options: CreateCommitOptions,
): Promise<CommitInfo> {
  const { owner, repo, branch, message, files } = options;

  logger.debug("github_create_commit_start", {
    message: `Creating commit on ${branch} with ${files.length} file(s)`,
    context: { owner, repo, branch, fileCount: files.length },
  });

  // Step 1: Get current commit SHA from branch
  const branchInfo = await getBranch(octokit, owner, repo, branch);
  const parentSha = branchInfo.sha;

  // Step 2: Get base tree SHA from parent commit
  const { data: parentCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: parentSha,
  });
  const baseTreeSha = parentCommit.tree.sha;

  // Step 3: Create tree with file changes
  const treeItems = files.map((f) => ({
    path: f.path,
    mode: f.mode || ("100644" as const),
    type: "blob" as const,
    content: f.content,
  }));

  const { data: tree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // Step 4: Create commit
  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [parentSha],
  });

  // Step 5: Update branch reference to point to new commit
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
  });

  logger.info("github_commit_created", {
    outcome: "success",
    message: `Commit created on ${branch}`,
    context: {
      owner,
      repo,
      branch,
      sha: commit.sha,
      fileCount: files.length,
    },
  });

  return {
    sha: commit.sha,
    message: commit.message,
    author: {
      name: commit.author?.name || "Unknown",
      email: commit.author?.email || "unknown@example.com",
      date: commit.author?.date || new Date().toISOString(),
    },
  };
}
