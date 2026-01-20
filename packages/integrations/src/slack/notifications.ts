/**
 * Slack Notification Functions
 *
 * Functions for posting notifications to Slack channels and users.
 * Formats messages using Block Kit for rich formatting.
 */

import { createLogger } from "@aesir/common";
import type { Block, KnownBlock, WebClient } from "@slack/web-api";
import type {
  ApprovalNotification,
  Notification,
  NotificationResult,
  StatusNotification,
} from "./types.js";

const logger = createLogger({
  defaultContext: { module: "slack-notifications" },
});

/**
 * Format an approval notification as Block Kit blocks
 *
 * Creates a formatted message for PR review requests.
 *
 * @param notification - Approval notification data
 * @returns Block Kit blocks array
 */
export function formatApprovalMessage(
  notification: ApprovalNotification,
): (Block | KnownBlock)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*PR Ready for Review*\n${notification.title}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: notification.summary,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${notification.prUrl}|View Pull Request>`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Task: ${notification.taskId} | Requested by: dev-agent`,
        },
      ],
    },
  ];
}

/**
 * Format a status notification as Block Kit blocks
 *
 * Creates a formatted message for task status updates.
 *
 * @param notification - Status notification data
 * @returns Block Kit blocks array
 */
export function formatStatusMessage(
  notification: StatusNotification,
): (Block | KnownBlock)[] {
  const statusEmoji: Record<StatusNotification["status"], string> = {
    started: ":arrow_forward:",
    completed: ":white_check_mark:",
    failed: ":x:",
  };

  const statusText: Record<StatusNotification["status"], string> = {
    started: "Task Started",
    completed: "Task Completed",
    failed: "Task Failed",
  };

  const blocks: (Block | KnownBlock)[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji[notification.status]} *${statusText[notification.status]}*\nTask: ${notification.taskId}`,
      },
    },
  ];

  if (notification.details) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: notification.details,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Get fallback text for push notifications
 *
 * @param notification - Notification data
 * @returns Plain text summary
 */
function getFallbackText(notification: Notification): string {
  if (notification.type === "approval_needed") {
    return `PR Ready for Review: ${notification.title}`;
  }

  const statusLabels: Record<StatusNotification["status"], string> = {
    started: "started",
    completed: "completed",
    failed: "failed",
  };

  return `Task ${notification.taskId} ${statusLabels[notification.status]}`;
}

/**
 * Post a notification to a Slack channel
 *
 * Handles both approval and status notifications, formatting
 * them appropriately with Block Kit.
 *
 * @param client - WebClient instance
 * @param notification - Notification payload
 * @param channel - Channel ID to post to
 * @returns Result with success status and message timestamp
 */
export async function postNotification(
  client: WebClient,
  notification: Notification,
  channel: string,
): Promise<NotificationResult> {
  const blocks =
    notification.type === "approval_needed"
      ? formatApprovalMessage(notification)
      : formatStatusMessage(notification);

  const text = getFallbackText(notification);

  try {
    const result = await client.chat.postMessage({
      channel,
      text,
      blocks,
    });

    logger.info("slack_notification_sent", {
      outcome: "success",
      message: `Notification sent to ${channel}`,
      context: {
        channel,
        type: notification.type,
        timestamp: result.ts,
      },
    });

    return result.ts
      ? { success: true, timestamp: result.ts }
      : { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("slack_notification_failed", {
      outcome: "failure",
      message: `Failed to send notification: ${errorMessage}`,
      context: {
        channel,
        type: notification.type,
        error: errorMessage,
      },
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send an approval request notification
 *
 * Semantic wrapper for postNotification for approval notifications.
 *
 * @param client - WebClient instance
 * @param notification - Approval notification data
 * @param channel - Channel ID to post to
 * @returns Result with success status and message timestamp
 */
export async function sendApprovalRequest(
  client: WebClient,
  notification: ApprovalNotification,
  channel: string,
): Promise<NotificationResult> {
  return postNotification(client, notification, channel);
}

/**
 * Send a status update notification
 *
 * Semantic wrapper for postNotification for status notifications.
 *
 * @param client - WebClient instance
 * @param notification - Status notification data
 * @param channel - Channel ID to post to
 * @returns Result with success status and message timestamp
 */
export async function sendStatusUpdate(
  client: WebClient,
  notification: StatusNotification,
  channel: string,
): Promise<NotificationResult> {
  return postNotification(client, notification, channel);
}

/**
 * Open a DM channel with a user
 *
 * Call this before sending a DM to get the conversation ID.
 * Slack requires you to open a conversation first before posting.
 *
 * @param client - WebClient instance
 * @param userId - Slack user ID (U1234567890)
 * @returns DM channel ID
 * @throws Error if conversation cannot be opened
 */
export async function openDmChannel(
  client: WebClient,
  userId: string,
): Promise<string> {
  logger.debug("slack_dm_open", {
    message: `Opening DM channel with user ${userId}`,
    context: { userId },
  });

  const result = await client.conversations.open({
    users: userId,
  });

  if (!result.channel?.id) {
    throw new Error(`Failed to open DM channel with user ${userId}`);
  }

  logger.debug("slack_dm_opened", {
    message: `DM channel opened`,
    context: { userId, channelId: result.channel.id },
  });

  return result.channel.id;
}
