/**
 * Block Kit Builders
 *
 * Functions for building Slack Block Kit blocks for rich message formatting.
 * Moved and enhanced from packages/integrations/src/slack/notifications.ts
 *
 * @see https://docs.slack.dev/messaging/creating-interactive-messages/
 */

import type { Block, KnownBlock } from "@slack/web-api";
import type {
  ApprovalBlockOptions,
  ProgressBlockOptions,
  StatusBlockOptions,
} from "./types.js";

/**
 * Build approval blocks with interactive approve/reject buttons
 *
 * Creates a formatted message for PR review requests with action buttons.
 *
 * @param options - Approval block options
 * @returns Block Kit blocks array
 */
export function buildApprovalBlocks(
  options: ApprovalBlockOptions,
): (Block | KnownBlock)[] {
  const { taskId, prUrl, title, summary, actionPrefix = "approve" } = options;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*PR Ready for Review*\n${title}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: summary,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${prUrl}|View Pull Request>`,
      },
    },
    {
      type: "actions",
      block_id: `${actionPrefix}_${taskId}`,
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
            emoji: true,
          },
          style: "primary",
          action_id: `${actionPrefix}_pr`,
          value: taskId,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reject",
            emoji: true,
          },
          style: "danger",
          action_id: "reject_pr",
          value: taskId,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Task: ${taskId} | Requested by: dev-agent`,
        },
      ],
    },
  ];
}

/**
 * Build status blocks for task lifecycle updates
 *
 * Creates a formatted message for task status updates with emoji indicators.
 *
 * @param options - Status block options
 * @returns Block Kit blocks array
 */
export function buildStatusBlocks(
  options: StatusBlockOptions,
): (Block | KnownBlock)[] {
  const { taskId, status, details } = options;

  const statusEmoji: Record<StatusBlockOptions["status"], string> = {
    started: ":arrow_forward:",
    completed: ":white_check_mark:",
    failed: ":x:",
  };

  const statusText: Record<StatusBlockOptions["status"], string> = {
    started: "Task Started",
    completed: "Task Completed",
    failed: "Task Failed",
  };

  const blocks: (Block | KnownBlock)[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji[status]} *${statusText[status]}*\nTask: ${taskId}`,
      },
    },
  ];

  if (details) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: details,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build a simple message block for conversational replies
 *
 * Creates a single section with mrkdwn text.
 *
 * @param text - Message text (supports mrkdwn formatting)
 * @returns Block Kit blocks array
 */
export function buildSimpleMessage(text: string): (Block | KnownBlock)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
    },
  ];
}

/**
 * Build progress blocks for showing work in progress
 *
 * Creates a formatted message with header, description, and optional steps.
 *
 * @param options - Progress block options
 * @returns Block Kit blocks array
 */
export function buildProgressBlocks(
  options: ProgressBlockOptions,
): (Block | KnownBlock)[] {
  const { title, description, steps } = options;

  const blocks: (Block | KnownBlock)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: title,
        emoji: true,
      },
    },
  ];

  if (description) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: description,
      },
    });
  }

  if (steps && steps.length > 0) {
    const stepsList = steps.map((step) => `- ${step}`).join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: stepsList,
      },
    });
  }

  return blocks;
}

/**
 * Get fallback text for a notification
 *
 * Returns plain text summary for push notifications and accessibility.
 *
 * @param type - Notification type discriminator
 * @param taskId - Task identifier
 * @param title - Optional title for approval notifications
 * @param status - Optional status for status notifications
 * @returns Plain text fallback
 */
export function getFallbackText(
  type: "approval_needed" | "status_update",
  taskId: string,
  title?: string,
  status?: "started" | "completed" | "failed",
): string {
  if (type === "approval_needed" && title) {
    return `PR Ready for Review: ${title}`;
  }

  if (type === "status_update" && status) {
    const statusLabels: Record<string, string> = {
      started: "started",
      completed: "completed",
      failed: "failed",
    };
    return `Task ${taskId} ${statusLabels[status]}`;
  }

  return `Task ${taskId} update`;
}
