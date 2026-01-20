/**
 * Temporal Workflow Definitions
 *
 * Workflows define the durable execution logic for approval gates.
 *
 * Note: Workflow code has special restrictions:
 * - Must be deterministic (no Math.random(), Date.now(), etc.)
 * - Cannot call external APIs directly (use activities instead)
 * - Must use Temporal's workflow API for time and randomness
 */

export {
  type ApprovalQueryStatus,
  type ApprovalWorkflowInput,
  type ApprovalWorkflowResult,
  approvalStatusQuery,
  prApprovalWorkflow,
} from "./approval-workflow.js";
