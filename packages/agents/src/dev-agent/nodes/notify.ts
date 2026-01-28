/**
 * Notify Node
 *
 * Sends Slack notification about PR creation. Updates existing approval
 * message if slackMessageTs exists, otherwise sends new message.
 * Non-critical - failures don't fail the workflow.
 *
 * Implements DEV-17 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { callMcpTool } from "../../mcp/index.js";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:notify",
});

/**
 * Node that sends Slack notification about PR.
 *
 * If slackMessageTs exists (from approval request), updates that message.
 * Otherwise, sends new message.
 *
 * On success: State unchanged (terminal node)
 * On failure: Logs warning but doesn't fail workflow (non-critical)
 */
export function createNotifyNode() {
  return async function notifyNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, prUrl, slackChannel, slackMessageTs } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue || !prUrl) {
      nodeLogger.warn("Missing issue or prUrl for notification");
      return {}; // Non-critical, don't fail
    }

    if (!slackChannel) {
      nodeLogger.warn("No Slack channel configured, skipping notification");
      return {};
    }

    const correlationId = `notify-${taskId}`;

    try {
      if (slackMessageTs) {
        // Update existing approval message
        nodeLogger.debug(
          { ts: slackMessageTs },
          "Updating existing Slack message",
        );
        await callMcpTool({
          integration: "slack",
          tool: "update_message",
          params: {
            channel: slackChannel,
            ts: slackMessageTs,
            text: `*PR Ready for Review:* ${issue.identifier}\n\n${prUrl}`,
          },
          agentId: "dev-agent",
          correlationId,
        });
      } else {
        // Send new message
        nodeLogger.debug("Sending new Slack notification");
        await callMcpTool({
          integration: "slack",
          tool: "send_message",
          params: {
            channel: slackChannel,
            text: `*PR created for* ${issue.identifier}: ${prUrl}`,
          },
          agentId: "dev-agent",
          correlationId,
        });
      }

      nodeLogger.info("Slack notification sent");
    } catch (error) {
      // Non-critical - don't fail workflow for notification failures
      nodeLogger.warn({ err: error }, "Failed to send Slack notification");
    }

    return {};
  };
}
