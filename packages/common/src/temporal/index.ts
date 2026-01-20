/**
 * Temporal Types Module
 *
 * Cross-layer type contracts for Temporal workflows and activities.
 * These types define the interface between platform (workflows) and agents (activities).
 */

import type { IssueStatus } from "../types/index.js";

/**
 * Input for merge PR activity
 */
export interface MergePRInput {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Pull request number to merge */
  pullNumber: number;
  /** Merge method (defaults to squash) */
  mergeMethod?: "merge" | "squash" | "rebase";
}

/**
 * Output from merge PR activity
 */
export interface MergePROutput {
  /** SHA of the merge commit */
  sha: string;
  /** Whether the PR was successfully merged */
  merged: boolean;
}

/**
 * Approval notification for Slack
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
 * Status notification for Slack
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

/**
 * Result of dev workflow execution
 */
export interface DevWorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** Final workflow status */
  status: string;
  /** PR number if created */
  prNumber?: number;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Bound activities interface for proxyActivities<BoundActivities>().
 * This defines the contract between workflows (platform) and activities (agents).
 */
export interface BoundActivities {
  /** Send approval request notification - bound with Slack client */
  sendApprovalRequestActivity: (
    notification: ApprovalNotification,
    channel: string,
  ) => Promise<NotificationResult>;

  /** Send status update notification - bound with Slack client */
  sendStatusUpdateActivity: (
    notification: StatusNotification,
    channel: string,
  ) => Promise<NotificationResult>;

  /** Merge pull request - bound with Octokit */
  mergePRActivity: (input: MergePRInput) => Promise<MergePROutput>;

  /** Update Linear issue status - bound with Linear client */
  updateLinearStatusActivity: (
    issueId: string,
    statusName: IssueStatus,
  ) => Promise<void>;

  /** Execute dev workflow - bound with all required dependencies */
  executeDevWorkflow: (
    taskId: string,
    sessionId: string,
  ) => Promise<DevWorkflowResult>;
}
