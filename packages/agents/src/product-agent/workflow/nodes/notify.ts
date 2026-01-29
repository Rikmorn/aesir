/**
 * Notify Node
 *
 * LangGraph node that sends Slack notification with created issue link.
 * Called after createTasks to notify user of successful issue creation.
 */

import {
  createPinoLogger,
  generateCorrelationId,
  type PinoLogger,
} from "@aesir/platform";
import { AIMessage } from "@langchain/core/messages";
import { callMcpTool } from "../../../shared/mcp/index.js";
import type { ProductAgentState, ProductAgentStateUpdate } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:notify",
});

const AGENT_ID = "product-agent";

/**
 * Build Linear issue URL from identifier.
 * Uses the standard Linear app URL format.
 */
function buildLinearUrl(identifier: string): string {
  return `https://linear.app/issue/${identifier}`;
}

/**
 * Create the notify node.
 *
 * @returns Node function for LangGraph
 */
export function notifyNode() {
  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "notify" });

    const correlationId = generateCorrelationId("agent");

    nodeLogger.debug(
      { createdTasksCount: state.createdTasks.length },
      "Sending issue creation notification",
    );

    // Build notification message
    let notificationText: string;

    if (state.createdTasks.length === 0) {
      notificationText =
        "I wasn't able to create an issue. Please try again or provide more details.";
    } else if (state.createdTasks.length === 1) {
      const task = state.createdTasks[0];
      // TypeScript narrowing: length check ensures task exists
      if (task) {
        const issueUrl = buildLinearUrl(task.identifier);
        notificationText = `Done! I've created issue *${task.identifier}*: ${task.title}\n\n${issueUrl}`;
      } else {
        notificationText =
          "I wasn't able to create an issue. Please try again or provide more details.";
      }
    } else {
      // Multiple issues created (work splitting)
      const issueList = state.createdTasks
        .map((task) => {
          const url = buildLinearUrl(task.identifier);
          return `- *${task.identifier}*: ${task.title}\n  ${url}`;
        })
        .join("\n");
      notificationText = `Done! I've created ${state.createdTasks.length} issues:\n\n${issueList}`;
    }

    // Send to Slack if we have context
    if (state.slackContext?.channelId && state.slackContext.threadTs) {
      try {
        await callMcpTool({
          integration: "slack",
          tool: "reply_to_thread",
          params: {
            channel: state.slackContext.channelId,
            thread_ts: state.slackContext.threadTs,
            text: notificationText,
          },
          agentId: AGENT_ID,
          correlationId,
        });

        nodeLogger.info(
          {
            threadTs: state.slackContext.threadTs,
            issueCount: state.createdTasks.length,
          },
          "Issue notification sent to Slack",
        );
      } catch (error) {
        nodeLogger.error({ err: error }, "Failed to send Slack notification");
        // Don't fail the node - issue was created successfully
      }
    } else {
      nodeLogger.debug({}, "No Slack context, skipping notification");
    }

    // Add AI message for conversation record
    const aiMessage = new AIMessage(notificationText);

    return {
      messages: [aiMessage],
      // Phase remains 'complete' from createTasks
    };
  };
}
