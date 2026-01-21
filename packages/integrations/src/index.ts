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
  LinearErrorCode,
  SlackErrorCode,
} from "./errors/index.js";
export {
  CredentialError,
  GitHubError,
  LinearError,
  SlackError,
} from "./errors/index.js";
// === GitHub ===
// GitHub API operations via Octokit
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
} from "./github/index.js";
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
} from "./github/index.js";
// === Linear ===
// Linear SDK integration with OAuth
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
  IssueStatus,
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
