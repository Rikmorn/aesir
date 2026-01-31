/**
 * Slack Message Types
 *
 * Type definitions for message posting, notifications, and Block Kit formatting.
 * Moved and enhanced from packages/integrations/src/slack/types.ts
 */

import type { Block, KnownBlock, WebClient } from "@slack/web-api";

/**
 * Types of notifications the agent can send
 */
export type NotificationType = "approval_needed" | "status_update";

/**
 * Approval notification - sent when plan or PR is ready for review
 */
export interface ApprovalNotification {
  /** Notification type discriminator */
  type: "approval_needed";
  /** Linear task identifier (e.g., ABC-123) */
  taskId: string;
  /** GitHub PR URL (omit or empty for plan approval) */
  prUrl?: string;
  /** PR or task title */
  title: string;
  /** Brief description of changes */
  summary: string;
  /** Action ID prefix for buttons (default "approve") */
  actionPrefix?: string;
}

/**
 * Status notification - sent for task lifecycle events
 */
export interface StatusNotification {
  /** Notification type discriminator */
  type: "status_update";
  /** Linear task identifier */
  taskId: string;
  /** Current task status */
  status: "started" | "completed" | "failed";
  /** Additional details (error message, completion info, etc.) */
  details: string | null;
}

/**
 * Union type for all notification payloads
 */
export type Notification = ApprovalNotification | StatusNotification;

/**
 * Result of a message posting operation
 * Contains ts and channel for tracking, replies, and updates
 */
export interface MessageResult {
  /** Slack message timestamp (for replies/updates) */
  ts: string;
  /** Channel where message was posted */
  channel: string;
}

/**
 * Options for sending a message to Slack
 */
export interface SendMessageOptions {
  /** WebClient instance for API calls */
  client: WebClient;
  /** Channel ID to post to (e.g., C1234567890) */
  channel: string;
  /** Fallback text for notifications and accessibility */
  text: string;
  /** Optional Block Kit blocks for rich formatting */
  blocks?: (Block | KnownBlock)[];
  /** Reply in thread if provided (message timestamp) */
  threadTs?: string;
  /** Unfurl links in message (default false for cleaner messages) */
  unfurlLinks?: boolean;
}

/**
 * Options for posting a notification (approval or status)
 */
export interface PostNotificationOptions {
  /** WebClient instance for API calls */
  client: WebClient;
  /** Notification payload */
  notification: Notification;
  /** Channel ID to post to */
  channel: string;
  /** Reply in thread if provided */
  threadTs?: string;
}

/**
 * Options for replying to an event while maintaining thread context
 */
export interface ReplyToEventOptions {
  /** WebClient instance for API calls */
  client: WebClient;
  /** Event context for thread awareness */
  event: {
    /** Channel where event occurred */
    channel: string;
    /** Event timestamp */
    ts: string;
    /** Parent thread timestamp (if event is in a thread) */
    thread_ts?: string;
  };
  /** Reply message text */
  text: string;
  /** Optional Block Kit blocks */
  blocks?: (Block | KnownBlock)[];
}

/**
 * Options for building approval blocks
 */
export interface ApprovalBlockOptions {
  /** Linear task identifier (e.g., ABC-123) */
  taskId: string;
  /** GitHub PR URL (omit for plan approval) */
  prUrl?: string;
  /** Title of the item needing approval */
  title: string;
  /** Brief description of changes */
  summary: string;
  /** Action ID prefix for buttons (default "approve") */
  actionPrefix?: string;
}

/**
 * Options for building escalation blocks
 *
 * Used when agent needs help and wants user to choose retry or abort.
 */
export interface EscalationBlockOptions {
  /** Linear task identifier (e.g., ABC-123) */
  taskId: string;
  /** Escalation title (e.g., "Dev-agent needs help with ON-123!") */
  title: string;
  /** Error message or description of what went wrong */
  errorDetails: string;
  /** Action ID prefix for buttons (default "escalation") */
  actionPrefix?: string;
}

/**
 * Options for building status blocks
 */
export interface StatusBlockOptions {
  /** Linear task identifier */
  taskId: string;
  /** Current task status */
  status: "started" | "completed" | "failed";
  /** Additional details */
  details?: string;
}

/**
 * Options for building progress blocks
 */
export interface ProgressBlockOptions {
  /** Progress title/header */
  title: string;
  /** Optional description */
  description?: string;
  /** Optional list of steps/items */
  steps?: string[];
}
