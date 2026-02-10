// === CLIENT FACTORY ===
export {
  createLinearClient,
  getLinearClient,
  refreshOAuthToken,
} from "./factory.js";
export type {
  CreateIssueParams,
  CreateIssueResult,
  LabelInfo,
  TeamInfo,
} from "./issues.js";

// === ISSUES ===
export {
  createIssue,
  listLabels,
  listTeams,
  readIssue,
  updateIssueStatus,
} from "./issues.js";
export type {
  ProactiveRefreshHandle,
  ProactiveRefreshOptions,
  RefreshMiddlewareOptions,
} from "./refresh-middleware.js";
// === REFRESH MIDDLEWARE ===
export {
  isAuthError,
  startProactiveRefresh,
  withTokenRefresh,
} from "./refresh-middleware.js";
export type { LinearOAuthConfig } from "./types.js";
