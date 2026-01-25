/**
 * Slack Temporal Activities
 *
 * Wraps Slack notification operations as Temporal activities.
 * Activities receive pre-configured WebClient from the workflow.
 *
 * NOTE: Uses dynamic import for @aesir/integrations to avoid
 * triggering config validation at module load time. This allows agents
 * to start without integration credentials (MCP migration).
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
// Import types only (doesn't trigger runtime validation)
import type {
  ApprovalNotification,
  MessageResult,
  StatusNotification,
} from "@aesir/integrations";
import type { WebClient } from "@slack/web-api";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:slack-activities",
});

/**
 * Send approval request notification as a Temporal activity.
 *
 * @param client - Pre-configured WebClient instance
 * @param notification - Approval notification payload
 * @param channel - Channel ID to post to
 * @returns Notification result with success status
 */
export async function sendApprovalRequestActivity(
  client: WebClient,
  notification: ApprovalNotification,
  channel: string,
): Promise<MessageResult> {
  logger.info(
    { taskId: notification.taskId, channel },
    `Sending approval request for task ${notification.taskId}`,
  );

  // Dynamic import to avoid triggering config validation at module load
  const { sendApprovalRequest } = await import("@aesir/integrations");
  return sendApprovalRequest(client, notification, channel);
}

/**
 * Send status update notification as a Temporal activity.
 *
 * @param client - Pre-configured WebClient instance
 * @param notification - Status notification payload
 * @param channel - Channel ID to post to
 * @returns Notification result with success status
 */
export async function sendStatusUpdateActivity(
  client: WebClient,
  notification: StatusNotification,
  channel: string,
): Promise<MessageResult> {
  logger.info(
    { taskId: notification.taskId, status: notification.status, channel },
    `Sending status update for task ${notification.taskId}`,
  );

  // Dynamic import to avoid triggering config validation at module load
  const { sendStatusUpdate } = await import("@aesir/integrations");
  return sendStatusUpdate(client, notification, channel);
}
