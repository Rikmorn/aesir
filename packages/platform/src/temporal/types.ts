/**
 * Shared types for Temporal workflow state and decisions
 *
 * These types are used by both workflows and external callers (activities, API endpoints).
 */

/**
 * Decision from a human reviewer on workflow approval
 */
export interface ApprovalDecision {
  /** Whether the work was approved */
  approved: boolean;
  /** Who made the decision (GitHub username, Slack user ID, etc.) */
  reviewer: string;
  /** Optional feedback or reason */
  comment?: string;
}

/**
 * Changes requested on a PR
 */
export interface ChangesRequested {
  /** Who requested the changes */
  reviewer: string;
  /** Description of what needs to change */
  feedback: string;
}

/**
 * Status of an approval workflow for query responses
 */
export interface ApprovalStatus {
  /** External task identifier (Linear task ID) */
  taskId: string;
  /** PR number if created (undefined if not yet created) */
  prNumber: number | undefined;
  /** Current workflow status */
  status:
    | "pending"
    | "running"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "timeout";
  /** The decision if one has been made */
  decision: ApprovalDecision | null;
  /** Whether changes have been requested */
  changesRequested: ChangesRequested | null;
}

/**
 * Configuration for starting an approval workflow
 */
export interface WorkflowConfig {
  /** Linear task ID for correlation */
  taskId: string;
  /** GitHub PR number */
  prNumber: number;
  /** GitHub PR URL for notifications */
  prUrl: string;
  /** Linear status to set after successful merge (configurable per project) */
  completionStatus: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Git branch name */
  branch: string;
  /** Days to wait for approval before timeout (default: 7) */
  approvalTimeoutDays?: number;
  /** Max iterations for changes-requested feedback loop (default: 3) */
  maxFeedbackIterations?: number;
}

/**
 * Result of an approval workflow
 */
export interface WorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** PR number if merge was successful */
  prNumber?: number;
  /** Reason for failure if not successful */
  reason?: string;
}
