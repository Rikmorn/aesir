/**
 * Temporal Infrastructure Module
 *
 * Provides durable workflow orchestration for human-in-the-loop approval flows.
 * This module is the public API for the Temporal infrastructure.
 *
 * @example
 * ```typescript
 * // Starting a workflow
 * import { getTemporalClient, type WorkflowConfig } from './temporal';
 *
 * const client = await getTemporalClient();
 * const config: WorkflowConfig = {
 *   taskId: 'LIN-123',
 *   prNumber: 42,
 *   prUrl: 'https://github.com/org/repo/pull/42',
 *   completionStatus: 'Done',
 *   owner: 'org',
 *   repo: 'repo',
 *   branch: 'feature/my-feature',
 * };
 *
 * // Sending an approval signal
 * import { sendApprovalSignal } from './temporal';
 * await sendApprovalSignal('approval-LIN-123', { approved: true, reviewer: 'user' });
 * ```
 */

// Client (for API endpoints and webhook handlers)
export {
  type ClientConfig,
  clearClientCache,
  getTemporalClient,
  sendApprovalSignal,
  sendChangesRequestedSignal,
} from "./client.js";

// Signals (for workflow and client code)
export { approvalSignal, changesRequestedSignal } from "./signals.js";
// Types
export type {
  ApprovalDecision,
  ApprovalStatus,
  ChangesRequested,
  WorkflowConfig,
  WorkflowResult,
} from "./types.js";
// Worker (for worker process)
export {
  createTemporalWorker,
  runWorker,
  type WorkerConfig,
} from "./worker.js";

// Workflows (for worker registration and type-safe invocation)
export {
  type ApprovalQueryStatus,
  type ApprovalWorkflowInput,
  type ApprovalWorkflowResult,
  approvalStatusQuery,
  prApprovalWorkflow,
} from "./workflows/index.js";
