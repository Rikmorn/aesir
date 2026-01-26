/**
 * Temporal Types for Product Agent Workflow
 *
 * Type definitions for product-agent conversation workflow input/output
 * and workflow state tracking.
 */

/**
 * Input for starting a product-agent conversation workflow
 */
export interface ProductAgentWorkflowInput {
  /** Slack thread timestamp - unique conversation ID */
  threadTs: string;
  /** Slack channel ID for replies */
  channelId: string;
  /** First user message to process */
  initialMessage: string;
  /** Slack user ID who initiated the conversation */
  userId: string;
  /** Slack team ID for MCP calls */
  slackTeamId: string;
  /** Linear team ID for issue creation */
  linearTeamId: string;
}

/**
 * Result of a product-agent conversation workflow
 */
export interface ProductAgentWorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** Terminal phase of the workflow */
  phase: "complete" | "declined" | "cancelled" | "timeout";
  /** Linear issue ID if created */
  issueId?: string;
  /** Linear issue identifier (e.g., "ABC-123") */
  issueIdentifier?: string;
}

/**
 * Workflow-level conversation phase tracking
 *
 * Note: This is separate from LangGraph's ProductAgentPhase which tracks
 * within-graph state. This tracks the Temporal workflow's overall state.
 */
export type ProductAgentWorkflowPhase =
  | "pending" // Workflow started, not yet processed
  | "running" // LangGraph is processing
  | "awaiting_reply" // Waiting for user reply signal
  | "complete" // Issue created successfully
  | "declined" // Non-actionable message (question/off-topic)
  | "cancelled" // User cancelled the conversation
  | "timeout"; // Conversation timed out after 72h

// === Dev Agent Workflow Types ===

/**
 * Input for starting a dev-agent workflow
 */
export interface DevAgentWorkflowInput {
  /** Task ID (Linear issue ID) */
  taskId: string;
  /** Linear issue identifier (e.g., ABC-123) */
  issueIdentifier: string;
  /** Linear issue data */
  issue: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    priority: number | null;
    labels: string[];
  };
  /** Slack channel for notifications */
  slackChannel: string;
}

/**
 * Workflow-level phase tracking for dev-agent
 *
 * Maps to LangGraph DevAgentPhase but tracked at Temporal level
 * for durability and signal-based flow control.
 */
export type DevAgentWorkflowPhase =
  | "pending" // Workflow started, not yet processed
  | "setup" // Setting up dev container
  | "researching" // Analyzing codebase
  | "planning" // Creating execution plan
  | "awaiting_approval" // Waiting for human approval signal
  | "executing" // Running implementation steps
  | "verifying" // Running tests
  | "creating_pr" // Creating pull request
  | "complete" // PR created successfully
  | "awaiting_feedback" // Waiting for PR review feedback signal
  | "addressing_feedback" // Processing PR review comments
  | "escalated" // Needs human intervention
  | "failed" // Unrecoverable error
  | "timeout"; // Workflow timed out

/**
 * Result of a dev-agent workflow
 */
export interface DevAgentWorkflowResult {
  /** Whether the workflow completed successfully (PR created) */
  success: boolean;
  /** Terminal phase of the workflow */
  phase: DevAgentWorkflowPhase;
  /** GitHub PR number if created */
  prNumber?: number | undefined;
  /** GitHub PR URL if created */
  prUrl?: string | undefined;
  /** Error message if failed/escalated */
  errorMessage?: string | undefined;
}
