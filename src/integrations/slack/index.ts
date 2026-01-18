/**
 * Slack Integration Module
 *
 * Provides WebClient factory, Bolt app lifecycle, and notification functions
 * for posting approval requests, status updates, and handling events.
 *
 * @example WebClient Usage (for posting messages)
 * ```typescript
 * import {
 *   createSlackClient,
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
 * // Send approval request to channel
 * await sendApprovalRequest(client, {
 *   type: 'approval_needed',
 *   taskId: 'ABC-123',
 *   prUrl: 'https://github.com/org/repo/pull/42',
 *   title: 'feat: Add user authentication',
 *   summary: 'Implements JWT-based auth with refresh tokens',
 * }, 'C1234567890');
 *
 * // Send DM to user
 * const dmChannelId = await openDmChannel(client, 'U1234567890');
 * await sendApprovalRequest(client, notification, dmChannelId);
 * ```
 *
 * @example Bolt App Usage (for receiving events)
 * ```typescript
 * import {
 *   createBoltApp,
 *   startBoltApp,
 *   stopBoltApp,
 * } from './integrations/slack';
 *
 * // Create Bolt app with Socket Mode
 * const app = createBoltApp({
 *   botToken: process.env.SLACK_BOT_TOKEN!,
 *   appToken: process.env.SLACK_APP_TOKEN!,
 *   socketMode: true,
 * });
 *
 * // Add event handlers
 * app.event('app_mention', async ({ event, say }) => {
 *   await say(`Hello <@${event.user}>!`);
 * });
 *
 * // Start the app
 * await startBoltApp(app);
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await stopBoltApp(app);
 *   process.exit(0);
 * });
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
  BoltAppConfig,
} from "./types.js";

// Client factory
export { createSlackClient, getSlackClient } from "./client.js";

// Bolt app lifecycle
export { createBoltApp, startBoltApp, stopBoltApp } from "./bolt-app.js";

// Notification functions
export {
  formatApprovalMessage,
  formatStatusMessage,
  postNotification,
  sendApprovalRequest,
  sendStatusUpdate,
  openDmChannel,
} from "./notifications.js";

// Product Agent event handlers
export {
  registerHandlers,
  handleAppMention,
  handleDirectMessage,
  type ThreadHandlerOptions,
} from "./assistant/index.js";
