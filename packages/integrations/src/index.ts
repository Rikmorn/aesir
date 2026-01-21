// @aesir/integrations - Linear, GitHub, Slack integrations
// Depends on: @aesir/common, @aesir/platform
// Used by: @aesir/agents

// === Re-exports from Common ===
// Types needed by agents via integrations
export type { ExecutionResult, Sandbox, TestResult } from "@aesir/common";
// === Re-exports from Platform ===
// Temporal client functions needed by agents
export type {
  ApprovalWorkflowInput,
  ClientConfig,
  WorkerConfig,
} from "@aesir/platform";
export {
  createTemporalWorker,
  DockerSandbox,
  getTemporalClient,
  runWorker,
  sendApprovalSignal,
  sendChangesRequestedSignal,
  startApprovalWorkflow,
} from "@aesir/platform";
// === Credential Store ===
// OAuth token management
export type {
  CredentialProvider,
  CredentialStore,
  CredentialStoreOptions,
  DecryptedCredential,
  StoreCredentialInput,
} from "./db/index.js";
export {
  createCredentialStore,
  deleteCredential,
  getCredential,
  getCredentialByProvider,
  storeCredential,
  updateCredentialTokens,
} from "./db/index.js";
// === Error Types ===
// Integration-specific error classes
export type {
  CredentialErrorCode,
  GitHubErrorCode,
  IntegrationServiceErrorCode,
  LinearErrorCode,
  SlackErrorCode,
} from "./errors/index.js";
export {
  CredentialError,
  GitHubError,
  IntegrationServiceError,
  LinearError,
  SlackError,
} from "./errors/index.js";
// === GitHub ===
/**
 * @deprecated Import from @aesir/integration-github directly.
 * GitHub has been extracted to a standalone package for independent deployment.
 * These re-exports are provided for backward compatibility only.
 *
 * @example
 * ```typescript
 * // Old (deprecated)
 * import { createGitHubClient } from '@aesir/integrations';
 *
 * // New (recommended)
 * import { createGitHubClient } from '@aesir/integration-github';
 * ```
 */
// Re-exported from @aesir/integration-github for backward compatibility
export type {
  BranchInfo,
  CommitInfo,
  CreateBranchOptions,
  CreateCommitOptions,
  CreatePROptions,
  FileChange as GitHubFileChange,
  GitHubConfig,
  PRComment,
  PullRequestInfo,
} from "@aesir/integration-github";
export {
  addPRComment,
  createBranch,
  createCommit,
  createGitHubClient,
  createPullRequest,
  getBranch,
  getOctokit,
  getPullRequest,
  listBranches,
  listPRComments,
  mergePullRequest,
} from "@aesir/integration-github";
// === Linear ===
/**
 * @deprecated Import from @aesir/integration-linear directly.
 * Linear has been extracted to a standalone package for independent deployment.
 * These re-exports are provided for backward compatibility only.
 *
 * @example
 * ```typescript
 * // Old (deprecated)
 * import { createLinearClient } from '@aesir/integrations';
 *
 * // New (recommended)
 * import { createLinearClient } from '@aesir/integration-linear';
 * ```
 */
// IssueStatus re-exported from @aesir/common (shared type)
export type { IssueStatus } from "@aesir/common";
// Re-exported from @aesir/integration-linear for backward compatibility
export type {
  ActionActivityContent,
  AgentActivityContent,
  AgentActivityType,
  AgentPlanItem,
  AgentSessionPayload,
  CreateIssueParams,
  CreateIssueResult,
  ElicitationActivityContent,
  ErrorActivityContent,
  LabelInfo,
  LinearConfig,
  ResponseActivityContent,
  TeamInfo,
  ThoughtActivityContent,
  WebhookPayload,
  WebhookPayloadBase,
} from "./linear/index.js";
export {
  CredentialNotFoundError,
  createIssue,
  createLinearClient,
  createLinearClientFromDatabase,
  emitAction,
  emitElicitation,
  emitError,
  emitResponse,
  emitThought,
  getLinearClient,
  isAgentSessionEvent,
  isIssueEvent,
  listLabels,
  listTeams,
  loadLinearTokens,
  parseWebhookPayload,
  readIssue,
  refreshOAuthToken,
  saveLinearTokens,
  updateIssueStatus,
  updateSessionPlan,
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "./linear/index.js";
// === Services ===
// Integration service factories
export type {
  CheckAndRecordResult,
  SyncCursorKey,
  SyncCursorService,
  SyncCursorServiceOptions,
  SyncCursorValue,
  WebhookIdempotencyOptions,
  WebhookIdempotencyService,
  WebhookProvider,
} from "./services/index.js";
export {
  createSyncCursorService,
  createWebhookIdempotencyService,
  WEBHOOK_DELIVERY_HEADERS,
} from "./services/index.js";
// === Slack ===
// Slack WebClient and Bolt app
export type {
  ApprovalNotification,
  BoltAppConfig,
  Notification,
  NotificationResult,
  NotificationType,
  SlackConfig,
  StatusNotification,
} from "./slack/index.js";
export {
  createBoltApp,
  createSlackClient,
  formatApprovalMessage,
  formatStatusMessage,
  getSlackClient,
  openDmChannel,
  postNotification,
  sendApprovalRequest,
  sendStatusUpdate,
  startBoltApp,
  stopBoltApp,
} from "./slack/index.js";
