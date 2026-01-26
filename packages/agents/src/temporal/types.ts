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
