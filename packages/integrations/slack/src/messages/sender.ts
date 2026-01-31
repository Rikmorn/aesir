/**
 * Thread-Aware Message Sender
 *
 * Functions for posting messages to Slack with thread context awareness.
 * Moved and enhanced from packages/integrations/src/slack/notifications.ts
 *
 * @see https://docs.slack.dev/reference/methods/chat.postMessage/
 */

import { createPinoLogger } from "@aesir/platform";
import type { Block, KnownBlock, WebClient } from "@slack/web-api";
import { SlackError } from "../types/errors.js";
import {
  buildApprovalBlocks,
  buildEscalationBlocks,
  buildStatusBlocks,
  getFallbackText,
} from "./blocks.js";
import type {
  ApprovalNotification,
  EscalationBlockOptions,
  MessageResult,
  PostNotificationOptions,
  ReplyToEventOptions,
  SendMessageOptions,
  StatusNotification,
} from "./types.js";

const logger = createPinoLogger({
  component: "integrations:slack:messages",
});

/**
 * Send a message to a Slack channel
 *
 * Posts a message with optional Block Kit formatting and thread awareness.
 * Returns message timestamp and channel for tracking, replies, and updates.
 *
 * @param options - Message options
 * @returns Message result with ts and channel
 * @throws SlackError on API failure
 */
export async function sendMessage(
  options: SendMessageOptions,
): Promise<MessageResult> {
  const { client, channel, text, blocks, threadTs, unfurlLinks } = options;

  try {
    // Build request with conditional properties for exactOptionalPropertyTypes
    const request: {
      channel: string;
      text: string;
      unfurl_links: boolean;
      blocks?: (Block | KnownBlock)[];
      thread_ts?: string;
    } = {
      channel,
      text,
      unfurl_links: unfurlLinks ?? false,
    };

    if (blocks) {
      request.blocks = blocks;
    }

    if (threadTs) {
      request.thread_ts = threadTs;
    }

    const result = await client.chat.postMessage(request);

    if (!result.ts || !result.channel) {
      throw new SlackError(
        "INT_SLACK_API",
        "Message posted but missing ts or channel in response",
      );
    }

    logger.info(
      { channel: result.channel, ts: result.ts, hasBlocks: !!blocks },
      "Message sent successfully",
    );

    return {
      ts: result.ts,
      channel: result.channel,
    };
  } catch (error) {
    logger.error({ err: error, channel }, "Failed to send message");

    if (error instanceof SlackError) {
      throw error;
    }

    const errorOptions: { cause?: Error; metadata: { channel: string } } = {
      metadata: { channel },
    };
    if (error instanceof Error) {
      errorOptions.cause = error;
    }

    throw new SlackError(
      "INT_SLACK_API",
      "Failed to send message",
      errorOptions,
    );
  }
}

/**
 * Reply to an event while maintaining thread context
 *
 * If the event is in a thread, replies there. Otherwise, starts a new thread
 * from the event message.
 *
 * @param options - Reply options with event context
 * @returns Message result with ts and channel
 */
export async function replyToEvent(
  options: ReplyToEventOptions,
): Promise<MessageResult> {
  const { client, event, text, blocks } = options;

  // Use thread_ts if event is in a thread, otherwise use event.ts to reply in thread
  const threadTs = event.thread_ts ?? event.ts;

  // Build options with conditional properties
  const sendOptions: SendMessageOptions = {
    client,
    channel: event.channel,
    text,
    threadTs,
  };

  if (blocks) {
    sendOptions.blocks = blocks;
  }

  return sendMessage(sendOptions);
}

/**
 * Post a notification to a Slack channel
 *
 * Handles both approval and status notifications, formatting
 * them appropriately with Block Kit.
 *
 * @param options - Notification options
 * @returns Message result with ts and channel
 */
export async function postNotification(
  options: PostNotificationOptions,
): Promise<MessageResult> {
  const { client, notification, channel, threadTs } = options;

  let blocks: (Block | KnownBlock)[];
  let text: string;

  if (notification.type === "approval_needed") {
    // Build approval block options with conditional optional fields
    const approvalOptions: Parameters<typeof buildApprovalBlocks>[0] = {
      taskId: notification.taskId,
      title: notification.title,
      summary: notification.summary,
    };
    if (notification.prUrl) {
      approvalOptions.prUrl = notification.prUrl;
    }
    if (notification.actionPrefix) {
      approvalOptions.actionPrefix = notification.actionPrefix;
    }
    blocks = buildApprovalBlocks(approvalOptions);
    text = getFallbackText(
      "approval_needed",
      notification.taskId,
      notification.title,
    );
  } else {
    // Build status block options with conditional details
    const statusOptions: Parameters<typeof buildStatusBlocks>[0] = {
      taskId: notification.taskId,
      status: notification.status,
    };
    if (notification.details) {
      statusOptions.details = notification.details;
    }

    blocks = buildStatusBlocks(statusOptions);
    text = getFallbackText(
      "status_update",
      notification.taskId,
      undefined,
      notification.status,
    );
  }

  logger.info(
    { channel, type: notification.type, taskId: notification.taskId },
    "Posting notification",
  );

  // Build send options with conditional threadTs
  const sendOptions: SendMessageOptions = {
    client,
    channel,
    text,
    blocks,
  };

  if (threadTs) {
    sendOptions.threadTs = threadTs;
  }

  return sendMessage(sendOptions);
}

/**
 * Send an approval request notification
 *
 * Semantic wrapper for posting approval notifications with action buttons.
 *
 * @param client - WebClient instance
 * @param notification - Approval notification data
 * @param channel - Channel ID to post to
 * @param threadTs - Optional thread timestamp for replies
 * @returns Message result with ts and channel
 */
export async function sendApprovalRequest(
  client: WebClient,
  notification: ApprovalNotification,
  channel: string,
  threadTs?: string,
): Promise<MessageResult> {
  const options: PostNotificationOptions = {
    client,
    notification,
    channel,
  };

  if (threadTs) {
    options.threadTs = threadTs;
  }

  return postNotification(options);
}

/**
 * Send a status update notification
 *
 * Semantic wrapper for posting status notifications.
 *
 * @param client - WebClient instance
 * @param notification - Status notification data
 * @param channel - Channel ID to post to
 * @param threadTs - Optional thread timestamp for replies
 * @returns Message result with ts and channel
 */
export async function sendStatusUpdate(
  client: WebClient,
  notification: StatusNotification,
  channel: string,
  threadTs?: string,
): Promise<MessageResult> {
  const options: PostNotificationOptions = {
    client,
    notification,
    channel,
  };

  if (threadTs) {
    options.threadTs = threadTs;
  }

  return postNotification(options);
}

/**
 * Send an escalation request notification
 *
 * Sends a message with Retry/Abort buttons when the agent needs human help.
 *
 * @param client - WebClient instance
 * @param options - Escalation options (taskId, title, errorDetails)
 * @param channel - Channel ID to post to
 * @param threadTs - Optional thread timestamp for replies
 * @returns Message result with ts and channel
 */
export async function sendEscalationRequest(
  client: WebClient,
  options: EscalationBlockOptions,
  channel: string,
  threadTs?: string,
): Promise<MessageResult> {
  const blocks = buildEscalationBlocks(options);
  const text = `${options.title}\n${options.errorDetails}`;

  logger.info(
    { channel, taskId: options.taskId },
    "Posting escalation request",
  );

  const sendOptions: SendMessageOptions = {
    client,
    channel,
    text,
    blocks,
  };

  if (threadTs) {
    sendOptions.threadTs = threadTs;
  }

  return sendMessage(sendOptions);
}

/**
 * Open a DM channel with a user
 *
 * Call this before sending a DM to get the conversation ID.
 * Slack requires opening a conversation before posting.
 *
 * @param client - WebClient instance
 * @param userId - Slack user ID (U1234567890)
 * @returns DM channel ID
 * @throws SlackError if conversation cannot be opened
 */
export async function openDmChannel(
  client: WebClient,
  userId: string,
): Promise<string> {
  logger.debug({ userId }, "Opening DM channel");

  try {
    const result = await client.conversations.open({
      users: userId,
    });

    if (!result.channel?.id) {
      throw new SlackError(
        "INT_SLACK_API",
        `Failed to open DM channel with user ${userId}`,
      );
    }

    logger.debug({ userId, channelId: result.channel.id }, "DM channel opened");

    return result.channel.id;
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to open DM channel");

    if (error instanceof SlackError) {
      throw error;
    }

    const errorOptions: { cause?: Error; metadata: { userId: string } } = {
      metadata: { userId },
    };
    if (error instanceof Error) {
      errorOptions.cause = error;
    }

    throw new SlackError(
      "INT_SLACK_API",
      `Failed to open DM channel with user ${userId}`,
      errorOptions,
    );
  }
}
