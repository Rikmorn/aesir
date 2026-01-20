/**
 * Create Branch Node
 *
 * LangGraph node that creates a feature branch for the task.
 * Uses factory pattern for dependency injection of Octokit and config.
 *
 * Branch naming follows the pattern: dev-agent/{taskId}
 * This ensures unique, identifiable branches per task.
 */

import type { Octokit } from "@octokit/rest";
import { createBranch } from "@aesir/integrations";
import type { DevWorkflowStateType } from "@aesir/common";

/**
 * GitHub repository configuration for branch operations
 */
export interface CreateBranchConfig {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Base branch to create from (default: 'main') */
  baseBranch: string;
}

/**
 * Factory function to create the branch node with injected dependencies.
 *
 * @param octokit - Authenticated Octokit instance
 * @param config - GitHub repository configuration
 * @returns LangGraph node function
 */
export function createBranchNode(octokit: Octokit, config: CreateBranchConfig) {
  /**
   * Create branch node - creates a feature branch for the task.
   *
   * @param state - Current workflow state with taskId
   * @returns Partial state update with branch name
   */
  return async function createBranchNodeFn(
    state: DevWorkflowStateType,
  ): Promise<Partial<DevWorkflowStateType>> {
    // Generate branch name from task ID
    const branchName = `dev-agent/${state.taskId}`;

    // Create the branch in GitHub
    await createBranch(octokit, {
      owner: config.owner,
      repo: config.repo,
      branchName,
      baseBranch: config.baseBranch,
    });

    // Return state update with branch name
    return { branchName };
  };
}
