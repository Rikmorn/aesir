/**
 * Slack Integration Module
 *
 * Provides WebClient factory and notification functions
 * for posting approval requests and status updates.
 *
 * @example
 * ```typescript
 * import {
 *   createSlackClient,
 *   getSlackClient,
 *   postNotification,
 *   sendApprovalRequest,
 *   sendStatusUpdate,
 *   openDmChannel,
 * } from './integrations/slack';
 *
 * // Create client with config
 * const client = createSlackClient({
 *   botToken: process.env.SLACK_BOT_TOKEN,
 *   defaultChannel: 'C1234567890',
 * });
 *
 * // Or create directly with token
 * const client = getSlackClient(process.env.SLACK_BOT_TOKEN);
 *
 * // Send approval request to channel
 * await sendApprovalRequest(client, {
 *   type: 'approval_needed',
 *   taskId: 'ABC-123',
 *   prUrl: 'https://github.com/org/repo/pull/42',
 *   title: 'feat: Add user authentication',
 *   summary: 'Implements JWT-based auth with refresh tokens',
 * }, 'C1234567890');
 *
 * // Send status update
 * await sendStatusUpdate(client, {
 *   type: 'status_update',
 *   taskId: 'ABC-123',
 *   status: 'completed',
 *   details: 'All tests passed',
 * }, 'C1234567890');
 *
 * // Send DM to user
 * const dmChannelId = await openDmChannel(client, 'U1234567890');
 * await sendApprovalRequest(client, notification, dmChannelId);
 * ```
 */

// Types
export type {
  SlackConfig,
  NotificationType,
  ApprovalNotification,
  StatusNotification,
  Notification,
  NotificationResult,
} from "./types.js";

// Client factory
export { createSlackClient, getSlackClient } from "./client.js";

// Notification functions
export {
  formatApprovalMessage,
  formatStatusMessage,
  postNotification,
  sendApprovalRequest,
  sendStatusUpdate,
  openDmChannel,
} from "./notifications.js";
