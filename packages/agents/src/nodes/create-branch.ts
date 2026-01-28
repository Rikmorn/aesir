/**
 * Create Branch Node
 *
 * LangGraph node that creates a feature branch for the task.
 * Uses factory pattern for dependency injection of config.
 *
 * Branch naming follows the pattern: dev-agent/{taskId}
 * This ensures unique, identifiable branches per task.
 */

import { generateCorrelationId } from "@aesir/platform";
import { callMcpTool } from "../mcp/index.js";
import type { DevWorkflowStateType } from "../state/index.js";

const AGENT_ID = "dev-agent";

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
 * Factory function to create the branch node with injected config.
 *
 * @param config - GitHub repository configuration
 * @returns LangGraph node function
 */
export function createBranchNode(config: CreateBranchConfig) {
  /**
   * Create branch node - creates a feature branch for the task.
   *
   * @param state - Current workflow state with taskId
   * @returns Partial state update with branch name
   */
  return async function createBranchNodeFn(
    state: DevWorkflowStateType,
  ): Promise<Partial<DevWorkflowStateType>> {
    const correlationId = generateCorrelationId("agent");

    // Generate branch name from task ID
    const branchName = `dev-agent/${state.taskId}`;

    // Create the branch in GitHub via MCP
    await callMcpTool({
      integration: "github",
      tool: "create_branch",
      params: {
        owner: config.owner,
        repo: config.repo,
        branchName,
        baseBranch: config.baseBranch,
      },
      agentId: AGENT_ID,
      correlationId,
    });

    // Return state update with branch name
    return { branchName };
  };
}
