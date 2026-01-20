/**
 * Slack Temporal Activities
 *
 * Wraps Slack notification operations as Temporal activities.
 * Activities receive pre-configured WebClient from the workflow.
 */

import type { WebClient } from "@slack/web-api";
import {
  sendApprovalRequest,
  sendStatusUpdate,
} from "../../integrations/slack/notifications.js";
import type {
  ApprovalNotification,
  NotificationResult,
  StatusNotification,
} from "../../integrations/slack/types.js";
import { createLogger } from "../../logging/logger.js";

const logger = createLogger({
  defaultContext: { module: "temporal-activity-slack" },
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
  logger.info("activity_slack_approval_request", {
    message: `Sending approval request for task ${notification.taskId}`,
    context: { taskId: notification.taskId, channel },
  });

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
  logger.info("activity_slack_status_update", {
    message: `Sending status update for task ${notification.taskId}`,
    context: {
      taskId: notification.taskId,
      status: notification.status,
      channel,
    },
  });

  return sendStatusUpdate(client, notification, channel);
}
