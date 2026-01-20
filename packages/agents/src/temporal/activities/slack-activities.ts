/**
 * Slack Temporal Activities
 *
 * Wraps Slack notification operations as Temporal activities.
 * Activities receive pre-configured WebClient from the workflow.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import {
  type ApprovalNotification,
  type NotificationResult,
  type StatusNotification,
  sendApprovalRequest,
  sendStatusUpdate,
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
): Promise<NotificationResult> {
  logger.info(
    { taskId: notification.taskId, channel },
    `Sending approval request for task ${notification.taskId}`,
  );

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
): Promise<NotificationResult> {
  logger.info(
    { taskId: notification.taskId, status: notification.status, channel },
    `Sending status update for task ${notification.taskId}`,
  );

  return sendStatusUpdate(client, notification, channel);
}
