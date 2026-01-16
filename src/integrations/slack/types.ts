/**
 * Slack Integration Types
 *
 * Type definitions for Slack API configuration and notification payloads.
 * These types support the agent's interaction with Slack's Web API
 * for posting approval requests and status updates.
 */

/**
 * Configuration for Slack API access
 */
export interface SlackConfig {
  /** Bot User OAuth Token (starts with xoxb-) */
  botToken: string;
  /** Default channel ID for notifications (e.g., C1234567890) */
  defaultChannel: string;
}

/**
 * Types of notifications the agent can send
 */
export type NotificationType = "approval_needed" | "status_update";

/**
 * Approval notification - sent when PR is ready for review
 */
export interface ApprovalNotification {
  /** Notification type discriminator */
  type: "approval_needed";
  /** Linear task identifier (e.g., ABC-123) */
  taskId: string;
  /** GitHub PR URL */
  prUrl: string;
  /** PR or task title */
  title: string;
  /** Brief description of changes */
  summary: string;
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
 * Result of a notification operation
 */
export interface NotificationResult {
  /** Whether the notification was sent successfully */
  success: boolean;
  /** Slack message timestamp (for replies/updates) */
  timestamp?: string;
  /** Error message if failed */
  error?: string;
}
