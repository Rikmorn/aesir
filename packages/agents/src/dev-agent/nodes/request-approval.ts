/**
 * Request Approval Node
 *
 * Posts execution plan to Linear and Slack for human approval.
 * Implements dual-channel approach:
 * - Linear: Full plan as comment (permanent record)
 * - Slack: Summary with approve/reject buttons (real-time notification)
 *
 * Implements DEV-08 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { callMcpTool } from "../../mcp/index.js";
import type { DevAgentState, ExecutionPlan } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:request-approval",
});

export interface RequestApprovalNodeDeps {
  slackChannel: string;
}

/**
 * Node that requests human approval for execution plan.
 *
 * Dual-channel approach:
 * 1. Posts full plan to Linear issue as comment (permanent record)
 * 2. Updates Linear issue status to "Awaiting Approval"
 * 3. Sends summary to Slack with Approve/Reject buttons (real-time)
 *
 * User can approve via either channel.
 *
 * On success: Sets slackMessageTs for later update, phase stays "awaiting_approval"
 * On failure: Sets phase to "failed" (but tries graceful degradation)
 */
export function createRequestApprovalNode(deps: RequestApprovalNodeDeps) {
  const { slackChannel } = deps;

  return async function requestApprovalNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, executionPlan } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue || !executionPlan) {
      return {
        phase: "failed",
        errorMessage: "Missing issue or plan for approval request",
      };
    }

    nodeLogger.info({ identifier: issue.identifier }, "Requesting approval");

    const planMarkdown = formatPlanAsMarkdown(executionPlan, issue.identifier);
    const correlationId = `approval-${taskId}`;
    let slackMessageTs: string | null = null;

    try {
      // Step 1: Post full plan to Linear as comment
      nodeLogger.debug("Posting plan to Linear");
      await callMcpTool({
        integration: "linear",
        tool: "create_comment",
        params: {
          issueId: issue.id,
          body: planMarkdown,
        },
        agentId: "dev-agent",
        correlationId,
      });

      // Step 2: Update Linear status to "Awaiting Approval"
      nodeLogger.debug("Updating Linear status");
      try {
        await callMcpTool({
          integration: "linear",
          tool: "update_issue_status",
          params: {
            issueId: issue.id,
            statusName: "Awaiting Approval",
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (statusErr) {
        // Status update is non-critical - workflow status may not exist
        nodeLogger.warn(
          { err: statusErr },
          "Failed to update Linear status (non-critical)",
        );
      }

      // Step 3: Send approval request to Slack
      nodeLogger.debug("Sending Slack approval request");
      const slackResult = await callMcpTool<{ ts: string; channel: string }>({
        integration: "slack",
        tool: "send_approval_request",
        params: {
          channel: slackChannel,
          taskId: issue.identifier,
          title: `Plan Ready: ${executionPlan.title}`,
          summary: formatPlanSummary(executionPlan),
          // prUrl omitted - no PR yet at plan approval stage
          actionPrefix: `approve_plan_${issue.identifier}`,
        },
        agentId: "dev-agent",
        correlationId,
      });

      slackMessageTs = slackResult.ts;

      nodeLogger.info(
        { slackTs: slackMessageTs },
        "Approval requested on both channels",
      );

      return {
        phase: "awaiting_approval",
        slackChannel,
        slackMessageTs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Failed to request approval");
      return {
        phase: "failed",
        errorMessage: `Approval request failed: ${message}`,
      };
    }
  };
}

/**
 * Format execution plan as Markdown for Linear comment
 */
function formatPlanAsMarkdown(
  plan: ExecutionPlan,
  issueIdentifier: string,
): string {
  const confidenceEmoji =
    plan.confidence === "high" ? "" : plan.confidence === "medium" ? "" : "";

  let markdown = `## Implementation Plan for ${issueIdentifier}\n\n`;
  markdown += `**Status:** Awaiting approval\n`;
  markdown += `**Confidence:** ${plan.confidence} ${confidenceEmoji}\n\n`;

  if (plan.confidence !== "high") {
    markdown += `> ${plan.confidenceReasoning}\n\n`;
  }

  markdown += `### Summary\n${plan.summary}\n\n`;

  markdown += `### Steps\n\n`;
  plan.steps.forEach((step, i) => {
    markdown += `**${i + 1}. ${step.description}**\n`;
    markdown += `- Files: ${step.files.join(", ")}\n`;
    markdown += `- Test: ${step.testStrategy}\n\n`;
  });

  markdown += `### Estimated Changes\n${plan.estimatedChanges}\n\n`;

  if (plan.risks.length > 0) {
    markdown += `### Risks\n`;
    for (const risk of plan.risks) {
      markdown += `- ${risk}\n`;
    }
    markdown += "\n";
  }

  markdown += "---\n\n";
  markdown += '**To approve:** Reply with "approved" or react with thumbs-up\n';
  markdown += "**To reject:** Reply with feedback for revision\n";

  return markdown;
}

/**
 * Format plan as brief summary for Slack
 */
function formatPlanSummary(plan: ExecutionPlan): string {
  const fileCount = plan.steps.reduce((sum, s) => sum + s.files.length, 0);
  const stepCount = plan.steps.length;

  return `${plan.summary}\n\nSteps: ${stepCount} | Files: ${fileCount} | Confidence: ${plan.confidence}`;
}
