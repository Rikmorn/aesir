/**
 * Escalate Node
 *
 * Notifies both Slack and Linear when dev-agent needs human help.
 * Posts error details to Linear as a comment and sends alert to Slack.
 * Non-critical failures don't fail the workflow.
 *
 * Implements DEV-22 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { callMcpTool } from "../../mcp/index.js";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:escalate",
});

/**
 * Node that escalates to human when agent is stuck.
 *
 * Notifies both channels:
 * 1. Posts error details to Linear issue as comment
 * 2. Sends alert to Slack channel
 *
 * Phase stays "escalated" - Temporal workflow will wait for human signal.
 */
export function createEscalateNode() {
  return async function escalateNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, errorMessage, slackChannel } = state;
    const nodeLogger = logger.child({ taskId });

    nodeLogger.info({ errorMessage }, "Escalating to human");

    const correlationId = `escalate-${taskId}`;
    const safeError = errorMessage || "Unknown error - dev-agent needs help";

    // Notify Linear
    if (issue) {
      try {
        await callMcpTool({
          integration: "linear",
          tool: "create_comment",
          params: {
            issueId: issue.id,
            body: `## Dev-Agent Needs Help\n\nI encountered an issue and need human assistance:\n\n\`\`\`\n${safeError}\n\`\`\`\n\nPlease review and provide guidance. You can reply here or in Slack.`,
          },
          agentId: "dev-agent",
          correlationId,
        });

        // Try to update status to Blocked (non-critical)
        try {
          await callMcpTool({
            integration: "linear",
            tool: "update_issue_status",
            params: {
              issueId: issue.id,
              statusName: "Blocked",
            },
            agentId: "dev-agent",
            correlationId,
          });
        } catch {
          // Non-critical - status name may not exist
        }
      } catch (linearErr) {
        nodeLogger.warn({ err: linearErr }, "Failed to notify Linear");
      }
    }

    // Notify Slack
    if (slackChannel) {
      try {
        const slackMessage = issue
          ? `*Dev-agent needs help with ${issue.identifier}!*\n\n${safeError}\n\nPlease check the Linear issue for details.`
          : `*Dev-agent needs help!*\n\n${safeError}`;

        await callMcpTool({
          integration: "slack",
          tool: "send_message",
          params: {
            channel: slackChannel,
            text: slackMessage,
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (slackErr) {
        nodeLogger.warn({ err: slackErr }, "Failed to notify Slack");
      }
    }

    nodeLogger.info("Escalation notifications sent");

    // Phase stays escalated - Temporal workflow will wait for human signal
    return {};
  };
}
