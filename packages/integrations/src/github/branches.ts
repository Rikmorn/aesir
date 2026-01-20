/**
 * GitHub Branch Operations
 *
 * Functions for managing branches in GitHub repositories.
 * Uses Octokit to interact with the GitHub REST API.
 */

import { createLogger } from "@aesir/common";
import type { Octokit } from "@octokit/rest";
import type { BranchInfo, CreateBranchOptions } from "./types.js";

const logger = createLogger({ defaultContext: { module: "github-branches" } });

/**
 * Get information about a specific branch
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param branch - Branch name
 * @returns Branch information including name, SHA, and protected status
 * @throws Error if branch not found
 */
export async function getBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<BranchInfo> {
  logger.debug("github_get_branch", {
    message: `Getting branch ${branch}`,
    context: { owner, repo, branch },
  });

  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  return {
    name: branch,
    sha: ref.object.sha,
    protected: false, // getRef doesn't return protection status
  };
}

/**
 * List all branches in a repository
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @returns Array of branch information
 */
export async function listBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<BranchInfo[]> {
  logger.debug("github_list_branches", {
    message: "Listing branches",
    context: { owner, repo },
  });

  const { data: branches } = await octokit.rest.repos.listBranches({
    owner,
    repo,
  });

  return branches.map((branch) => ({
    name: branch.name,
    sha: branch.commit.sha,
    protected: branch.protected,
  }));
}

/**
 * Create a new branch from a base branch
 *
 * Creates a new Git reference pointing to the same commit as the base branch.
 *
 * @param octokit - Authenticated Octokit instance
 * @param options - Branch creation options
 * @returns Information about the newly created branch
 * @throws Error if base branch not found or branch creation fails
 */
export async function createBranch(
  octokit: Octokit,
  options: CreateBranchOptions,
): Promise<BranchInfo> {
  const { owner, repo, branchName, baseBranch = "main" } = options;

  logger.debug("github_create_branch_start", {
    message: `Creating branch ${branchName} from ${baseBranch}`,
    context: { owner, repo, branchName, baseBranch },
  });

  // Get the SHA of the base branch
  const baseInfo = await getBranch(octokit, owner, repo, baseBranch);

  // Create the new branch reference
  const { data: ref } = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseInfo.sha,
  });

  logger.info("github_branch_created", {
    outcome: "success",
    message: `Branch ${branchName} created from ${baseBranch}`,
    context: { owner, repo, branchName, baseBranch, sha: ref.object.sha },
  });

  return {
    name: branchName,
    sha: ref.object.sha,
    protected: false,
  };
}
