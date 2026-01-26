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
