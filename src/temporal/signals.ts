/**
 * Signal definitions for Temporal workflow communication
 *
 * Signals allow external code to send data to running workflows.
 * These definitions are shared between workflow code and client code.
 */

import * as wf from "@temporalio/workflow";

import type { ApprovalDecision, ChangesRequested } from "./types.js";

/**
 * Signal to deliver approval/rejection decision to a workflow
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(approvalSignal, { approved: true, reviewer: 'user123' });
 * ```
 */
export const approvalSignal = wf.defineSignal<[ApprovalDecision]>("approval");

/**
 * Signal to deliver PR feedback requesting changes
 *
 * When a reviewer requests changes on a PR, this signal notifies the workflow
 * to attempt automatic fixes or escalate.
 *
 * Usage from client:
 * ```typescript
 * const handle = client.workflow.getHandle(workflowId);
 * await handle.signal(changesRequestedSignal, { reviewer: 'user123', feedback: 'Fix the tests' });
 * ```
 */
export const changesRequestedSignal =
  wf.defineSignal<[ChangesRequested]>("changes_requested");
