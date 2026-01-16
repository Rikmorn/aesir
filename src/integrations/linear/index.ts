/**
 * Linear Integration Module
 *
 * Provides Linear SDK client factory with OAuth token management
 * and helpers for issue operations.
 *
 * @example
 * ```typescript
 * import { createLinearClient, readIssue, updateIssueStatus } from './integrations/linear';
 *
 * const client = await createLinearClient(config);
 * const issue = await readIssue(client, 'ABC-123');
 * await updateIssueStatus(client, 'ABC-123', 'In Progress');
 * ```
 */

// Types
export type {
  LinearConfig,
  WebhookPayload,
  AgentSessionPayload,
  AgentActivityType,
  ThoughtActivityContent,
  ActionActivityContent,
  ResponseActivityContent,
  ErrorActivityContent,
  ElicitationActivityContent,
  AgentActivityContent,
  IssueStatus,
  AgentPlanItem,
} from "./types.js";

// Client factory and helpers
export {
  createLinearClient,
  getLinearClient,
  refreshOAuthToken,
  readIssue,
  updateIssueStatus,
} from "./client.js";
