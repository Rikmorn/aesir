/**
 * Slack Integration Re-exports
 *
 * This module re-exports from @aesir/integration-slack for backward compatibility.
 * New code should import directly from @aesir/integration-slack.
 *
 * @deprecated Import from @aesir/integration-slack instead
 */

// === BOLT APP ===
export {
  createBoltApp,
  startBoltApp,
  stopBoltApp,
} from "@aesir/integration-slack";

// === CLIENT ===
export {
  createSlackClient,
  getSlackClient,
  createSlackClientFromDatabase,
} from "@aesir/integration-slack";

// === MESSAGES ===
export {
  sendApprovalRequest,
  sendStatusUpdate,
  sendMessage,
  postNotification,
  openDmChannel,
  buildApprovalBlocks,
  buildStatusBlocks,
} from "@aesir/integration-slack";

// Aliases for backward compatibility
// Old names preserved where possible
export { buildApprovalBlocks as formatApprovalMessage } from "@aesir/integration-slack";
export { buildStatusBlocks as formatStatusMessage } from "@aesir/integration-slack";

// === TYPES ===
export type {
  ApprovalNotification,
  StatusNotification,
  Notification,
  NotificationType,
  MessageResult,
  // Client types
  SlackClientConfig,
  BoltAppOptions,
  BoltAppDependencies,
} from "@aesir/integration-slack";

// Type aliases for backward compatibility
// Old name: SlackConfig -> New: SlackClientConfig
export type { SlackClientConfig as SlackConfig } from "@aesir/integration-slack";

// Old name: BoltAppConfig was simpler, now BoltAppOptions with modes
// Re-export new name with alias for transitioning code
export type { BoltAppOptions as BoltAppConfig } from "@aesir/integration-slack";

// Note: NotificationResult was { success, timestamp?, error? }
// MessageResult is { ts, channel } - different semantic
// Cannot provide direct alias, consumers need to migrate
