/**
 * Slack Temporal Activities
 *
 * Wraps Slack notification operations as Temporal activities using MCP calls.
 * Activities communicate with the Slack integration service via HTTP.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { callMcpTool } from "../../mcp/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:slack-activities",
});

/**
 * Approval notification payload
 */
export interface ApprovalNotification {
  type: "approval_needed";
  taskId: string;
  prUrl: string;
  title: string;
  summary: string;
}

/**
 * Status notification payload
 */
export interface StatusNotification {
  taskId: string;
  status: string;
  message: string;
}

/**
 * Result of sending a message
 */
export interface MessageResult {
  success: boolean;
  ts?: string;
  channel?: string;
}

/**
 * Send approval request notification as a Temporal activity.
 *
 * @param notification - Approval notification payload
 * @param channel - Channel ID to post to
 * @returns Notification result with success status
 */
export async function sendApprovalRequestActivity(
  notification: ApprovalNotification,
  channel: string,
): Promise<MessageResult> {
  logger.info(
    { taskId: notification.taskId, channel },
    `Sending approval request for task ${notification.taskId}`,
  );

  // Call Slack integration service via MCP
  const result = await callMcpTool<MessageResult>({
    integration: "slack",
    tool: "send_approval_request",
    params: {
      channel,
      taskId: notification.taskId,
      prUrl: notification.prUrl,
      title: notification.title,
      summary: notification.summary,
    },
    agentId: "temporal-worker",
    correlationId: `slack-approval-${notification.taskId}`,
  });

  return result;
}

/**
 * Send status update notification as a Temporal activity.
 *
 * @param notification - Status notification payload
 * @param channel - Channel ID to post to
 * @returns Notification result with success status
 */
export async function sendStatusUpdateActivity(
  notification: StatusNotification,
  channel: string,
): Promise<MessageResult> {
  logger.info(
    { taskId: notification.taskId, status: notification.status, channel },
    `Sending status update for task ${notification.taskId}`,
  );

  // Call Slack integration service via MCP
  const result = await callMcpTool<MessageResult>({
    integration: "slack",
    tool: "send_message",
    params: {
      channel,
      text: `*Task ${notification.taskId}*: ${notification.status}\n${notification.message}`,
    },
    agentId: "temporal-worker",
    correlationId: `slack-status-${notification.taskId}`,
  });

  return result;
}
