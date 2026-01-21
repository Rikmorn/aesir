/**
 * GitHub Pull Request Operations
 *
 * Functions for creating and managing pull requests in GitHub repositories.
 * Uses Octokit to interact with the GitHub REST API.
 */

import { createPinoLogger } from "@aesir/common";
import type { Octokit } from "@octokit/rest";
import type {
  CreatePROptions,
  PRComment,
  PullRequestInfo,
} from "../client/types.js";

const logger = createPinoLogger({
  component: "integrations:github:pull-requests",
});

/**
 * Create a new pull request
 *
 * @param octokit - Authenticated Octokit instance
 * @param options - Pull request creation options
 * @returns Information about the created pull request
 * @throws Error if PR creation fails (e.g., no commits between branches)
 */
export async function createPullRequest(
  octokit: Octokit,
  options: CreatePROptions,
): Promise<PullRequestInfo> {
  const { owner, repo, title, body, head, base } = options;

  logger.debug({ owner, repo, head, base }, `Creating PR: ${title}`);

  // Build request params, only including body if defined (exactOptionalPropertyTypes)
  const params: Parameters<typeof octokit.rest.pulls.create>[0] = {
    owner,
    repo,
    title,
    head,
    base,
  };
  if (body !== undefined) {
    params.body = body;
  }

  const { data: pr } = await octokit.rest.pulls.create(params);

  logger.info(
    { owner, repo, number: pr.number, url: pr.html_url },
    `PR #${pr.number} created`,
  );

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state as "open" | "closed",
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    url: pr.html_url,
  };
}

/**
 * Get information about a pull request
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param pullNumber - Pull request number
 * @returns Information about the pull request
 * @throws Error if PR not found
 */
export async function getPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestInfo> {
  logger.debug({ owner, repo, pullNumber }, `Getting PR #${pullNumber}`);

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state as "open" | "closed",
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    url: pr.html_url,
  };
}

/**
 * List all comments on a pull request
 *
 * Combines both review comments (on specific lines of code) and
 * issue comments (in the conversation thread), sorted by creation time.
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param pullNumber - Pull request number
 * @returns Array of comments sorted by creation time
 */
export async function listPRComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PRComment[]> {
  logger.debug(
    { owner, repo, pullNumber },
    `Listing comments on PR #${pullNumber}`,
  );

  // Get review comments (on specific lines of code)
  const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: pullNumber,
  });

  // Get issue comments (conversation thread)
  const { data: issueComments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullNumber,
  });

  // Map review comments
  const reviewMapped: PRComment[] = reviewComments.map((c) => ({
    id: c.id,
    body: c.body,
    user: c.user?.login || "unknown",
    createdAt: c.created_at,
    path: c.path,
  }));

  // Map issue comments
  const issueMapped: PRComment[] = issueComments.map((c) => ({
    id: c.id,
    body: c.body || "",
    user: c.user?.login || "unknown",
    createdAt: c.created_at,
  }));

  // Combine and sort by creation time
  const allComments = [...reviewMapped, ...issueMapped].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return allComments;
}

/**
 * Add a comment to a pull request conversation
 *
 * Creates an issue comment (in the conversation thread, not on a specific line).
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param pullNumber - Pull request number
 * @param body - Comment text
 * @returns The created comment
 */
export async function addPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<PRComment> {
  logger.debug(
    { owner, repo, pullNumber, bodyLength: body.length },
    `Adding comment to PR #${pullNumber}`,
  );

  const { data: comment } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });

  logger.info(
    { owner, repo, pullNumber, commentId: comment.id },
    `Comment added to PR #${pullNumber}`,
  );

  return {
    id: comment.id,
    body: comment.body || "",
    user: comment.user?.login || "unknown",
    createdAt: comment.created_at,
  };
}

/**
 * Merge a pull request
 *
 * Merges using the squash method by default for cleaner history.
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param pullNumber - Pull request number to merge
 * @param options - Optional merge configuration
 * @returns Merge result with SHA
 * @throws Error if PR cannot be merged (not mergeable, conflicts, etc.)
 */
export async function mergePullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  options?: {
    mergeMethod?: "merge" | "squash" | "rebase";
    commitTitle?: string;
    commitMessage?: string;
  },
): Promise<{ sha: string; merged: boolean }> {
  logger.debug(
    { owner, repo, pullNumber, method: options?.mergeMethod ?? "squash" },
    `Merging PR #${pullNumber}`,
  );

  // Build request params, only including optional fields if defined (exactOptionalPropertyTypes)
  const params: Parameters<typeof octokit.rest.pulls.merge>[0] = {
    owner,
    repo,
    pull_number: pullNumber,
    merge_method: options?.mergeMethod ?? "squash",
  };
  if (options?.commitTitle !== undefined) {
    params.commit_title = options.commitTitle;
  }
  if (options?.commitMessage !== undefined) {
    params.commit_message = options.commitMessage;
  }

  const { data } = await octokit.rest.pulls.merge(params);

  logger.info(
    { owner, repo, pullNumber, sha: data.sha },
    `PR #${pullNumber} merged`,
  );

  return { sha: data.sha, merged: data.merged };
}
