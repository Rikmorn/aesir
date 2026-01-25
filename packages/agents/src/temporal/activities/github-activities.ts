/**
 * GitHub Temporal Activities
 *
 * Wraps GitHub operations as Temporal activities using MCP calls.
 * Activities communicate with the GitHub integration service via HTTP.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { callMcpTool } from "../../mcp/index.js";

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
 * @param input - Merge parameters
 * @returns Merge result with SHA and success status
 */
export async function mergePRActivity(
  input: MergePRInput,
): Promise<MergePROutput> {
  logger.info(
    { owner: input.owner, repo: input.repo, pullNumber: input.pullNumber },
    `Merging PR #${input.pullNumber}`,
  );

  // Call GitHub integration service via MCP
  const result = await callMcpTool<MergePROutput>({
    integration: "github",
    tool: "merge_pull_request",
    params: {
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pullNumber,
      mergeMethod: input.mergeMethod ?? "squash",
    },
    agentId: "temporal-worker",
    correlationId: `github-merge-${input.owner}/${input.repo}#${input.pullNumber}`,
  });

  logger.info(
    { sha: result.sha, pullNumber: input.pullNumber },
    `PR #${input.pullNumber} merged`,
  );

  return result;
}
