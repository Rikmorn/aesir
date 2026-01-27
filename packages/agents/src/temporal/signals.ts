/**
 * Signal definitions for Product Agent Temporal workflow
 *
 * Signals allow external code to send data to running workflows.
 * These definitions are shared between workflow code and client code.
 */

import * as wf from "@temporalio/workflow";

/**
 * Signal to deliver user's reply to a product-agent conversation workflow
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(userReplySignal, 'user reply text');
 * ```
 */
export const userReplySignal = wf.defineSignal<[string]>("userReply");

/**
 * Signal to cancel a product-agent conversation
 *
 * Triggered when user says "nevermind" or similar cancellation phrases.
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(cancelConversationSignal);
 * ```
 */
export const cancelConversationSignal = wf.defineSignal("cancelConversation");

// === Dev Agent Signals ===

/**
 * Plan approval signal payload
 */
export interface PlanApprovalPayload {
  /** Whether the plan was approved */
  approved: boolean;
  /** Feedback explaining rejection or changes requested */
  feedback?: string;
  /** Name of the approver (for display purposes) */
  approverName?: string;
  /** Source channel of the approval */
  source?: "slack" | "linear";
}

/**
 * Signal for plan approval (can come from Linear comment or Slack button)
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(planApprovalSignal, { approved: true, approverName: "John", source: "slack" });
 * // or with feedback: await handle.signal(planApprovalSignal, { approved: false, feedback: "Missing tests" });
 * ```
 */
export const planApprovalSignal =
  wf.defineSignal<[PlanApprovalPayload]>("planApproval");

/**
 * Signal for PR review feedback (from GitHub review or Slack)
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(prFeedbackSignal, 'Please add more tests for edge cases');
 * ```
 */
export const prFeedbackSignal = wf.defineSignal<[string]>("prFeedback");

/**
 * Signal for human resolution of escalation
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(escalationResolvedSignal, { action: "retry", guidance: "Try using mocks" });
 * ```
 */
export const escalationResolvedSignal =
  wf.defineSignal<[{ action: "retry" | "abort"; guidance?: string }]>(
    "escalationResolved",
  );
