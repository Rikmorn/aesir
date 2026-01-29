/**
 * Create PR Node
 *
 * Creates a GitHub pull request from the verified branch and updates
 * Linear issue status to "In Review". Non-critical operations (status
 * update, comment) don't fail the workflow.
 *
 * Implements DEV-15 through DEV-18 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { callMcpTool } from "../../shared/mcp/index.js";
import type { DevAgentState, ExecutionPlan } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:create-pr",
});

export interface CreatePRNodeDeps {
  owner: string;
  repo: string;
  baseBranch: string;
}

/**
 * Node that creates GitHub PR and updates Linear status.
 *
 * Steps:
 * 1. Create PR via github.create_pull_request MCP tool
 * 2. Update Linear issue status to "In Review"
 * 3. Add PR link as Linear comment
 *
 * On success: Sets prNumber, prUrl, phase to "complete"
 * On failure: Sets phase to "escalated"
 */
export function createPRNode(deps: CreatePRNodeDeps) {
  const { owner, repo, baseBranch } = deps;

  return async function createPRNodeFn(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, executionPlan, branchName } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue || !executionPlan || !branchName) {
      return {
        phase: "failed",
        errorMessage: "Missing required state for PR creation",
      };
    }

    nodeLogger.info(
      { identifier: issue.identifier, branchName },
      "Creating PR",
    );

    const correlationId = `pr-${taskId}`;

    try {
      // Step 1: Create GitHub PR
      const prBody = formatPRDescription(issue, executionPlan);

      const prResult = await callMcpTool<{
        number: number;
        url: string;
      }>({
        integration: "github",
        tool: "create_pull_request",
        params: {
          owner,
          repo,
          title: `feat: ${executionPlan.title}`,
          body: prBody,
          head: branchName,
          base: baseBranch,
        },
        agentId: "dev-agent",
        correlationId,
      });

      const prNumber = prResult.number;
      const prUrl = prResult.url;

      nodeLogger.info({ prNumber, prUrl }, "PR created");

      // Step 2: Update Linear status to "In Review" (non-critical)
      try {
        await callMcpTool({
          integration: "linear",
          tool: "update_issue_status",
          params: {
            issueId: issue.id,
            statusName: "In Review",
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (statusErr) {
        // Non-critical - status name may not exist in workflow
        nodeLogger.warn(
          { err: statusErr },
          "Failed to update Linear status to In Review",
        );
      }

      // Step 3: Add PR link as Linear comment (non-critical)
      try {
        await callMcpTool({
          integration: "linear",
          tool: "create_comment",
          params: {
            issueId: issue.id,
            body: `PR created: ${prUrl}`,
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (commentErr) {
        nodeLogger.warn({ err: commentErr }, "Failed to add PR link comment");
      }

      return {
        prNumber,
        prUrl,
        phase: "complete",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "PR creation failed");
      return {
        phase: "escalated",
        errorMessage: `PR creation failed: ${message}`,
      };
    }
  };
}

/**
 * Format PR description with issue link and implementation steps.
 */
function formatPRDescription(
  issue: { identifier: string; title: string; description: string | null },
  plan: ExecutionPlan,
): string {
  let description = `Closes ${issue.identifier}\n\n`;
  description += `## Summary\n${plan.summary}\n\n`;

  description += `## Changes\n`;
  for (const [index, step] of plan.steps.entries()) {
    description += `${index + 1}. ${step.description}\n`;
    description += `   - Files: ${step.files.join(", ")}\n`;
  }

  description += `\n## Testing\n`;
  description += `- All tests pass\n`;
  description += `- Lint check passes\n`;

  description += `\n---\n`;
  description += `*This PR was created by dev-agent*`;

  return description;
}
