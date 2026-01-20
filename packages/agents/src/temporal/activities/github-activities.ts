/**
 * GitHub Temporal Activities
 *
 * Wraps GitHub operations as Temporal activities.
 * Activities receive pre-configured Octokit clients from the workflow.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { mergePullRequest } from "@aesir/integrations";
import type { Octokit } from "@octokit/rest";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:github-activities",
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
  input: MergePRInput,
): Promise<MergePROutput> {
  logger.info(
    { owner: input.owner, repo: input.repo, pullNumber: input.pullNumber },
    `Merging PR #${input.pullNumber}`,
  );

  // Build options only with defined values (exactOptionalPropertyTypes)
  const options: { mergeMethod?: "merge" | "squash" | "rebase" } | undefined =
    input.mergeMethod !== undefined
      ? { mergeMethod: input.mergeMethod }
      : undefined;

  const result = await mergePullRequest(
    octokit,
    input.owner,
    input.repo,
    input.pullNumber,
    options,
  );

  logger.info(
    { sha: result.sha, pullNumber: input.pullNumber },
    `PR #${input.pullNumber} merged`,
  );

  return result;
}
