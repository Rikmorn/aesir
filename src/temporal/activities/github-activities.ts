/**
 * GitHub Temporal Activities
 *
 * Wraps GitHub operations as Temporal activities.
 * Activities receive pre-configured Octokit clients from the workflow.
 */

import type { Octokit } from "@octokit/rest";
import { mergePullRequest } from "../../integrations/github/pull-requests.js";
import { createLogger } from "../../logging/logger.js";

const logger = createLogger({
  defaultContext: { module: "temporal-activity-github" },
});

/**
 * Input for merge PR activity
 */
export interface MergePRInput {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Pull request number to merge */
  pullNumber: number;
  /** Merge method (defaults to squash) */
  mergeMethod?: "merge" | "squash" | "rebase";
}

/**
 * Output from merge PR activity
 */
export interface MergePROutput {
  /** SHA of the merge commit */
  sha: string;
  /** Whether the PR was successfully merged */
  merged: boolean;
}

/**
 * Merge a pull request as a Temporal activity.
 *
 * @param octokit - Pre-configured Octokit instance
 * @param input - Merge parameters
 * @returns Merge result with SHA and success status
 */
export async function mergePRActivity(
  octokit: Octokit,
  input: MergePRInput
): Promise<MergePROutput> {
  logger.info("activity_merge_pr_start", {
    message: `Merging PR #${input.pullNumber}`,
    context: {
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pullNumber,
    },
  });

  // Build options only with defined values (exactOptionalPropertyTypes)
  const options: { mergeMethod?: "merge" | "squash" | "rebase" } | undefined =
    input.mergeMethod !== undefined ? { mergeMethod: input.mergeMethod } : undefined;

  const result = await mergePullRequest(
    octokit,
    input.owner,
    input.repo,
    input.pullNumber,
    options
  );

  logger.info("activity_merge_pr_complete", {
    outcome: "success",
    message: `PR #${input.pullNumber} merged`,
    context: { sha: result.sha },
  });

  return result;
}
