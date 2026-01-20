/**
 * Pickup Task Node
 *
 * LangGraph node that reads a task from Linear and updates its status to "In Progress".
 * Uses factory pattern for dependency injection.
 *
 * This is the first node in the dev workflow - it initializes the state with
 * task details from Linear and signals that work has started.
 */

import type { LinearClient } from "@linear/sdk";
import {
  emitThought,
  readIssue,
  updateIssueStatus,
} from "@aesir/integrations";
import type { DevWorkflowStateType } from "@aesir/common";

/**
 * Factory function to create the pickup task node with injected LinearClient.
 *
 * @param linearClient - Authenticated LinearClient instance
 * @returns LangGraph node function
 */
export function createPickupTaskNode(linearClient: LinearClient) {
  /**
   * Pickup task node - reads task from Linear and updates status.
   *
   * @param state - Current workflow state with taskId
   * @returns Partial state update with task description and coding status
   */
  return async function pickupTaskNode(
    state: DevWorkflowStateType,
  ): Promise<Partial<DevWorkflowStateType>> {
    // Read task details from Linear
    const issue = await readIssue(linearClient, state.taskId);

    // Update status to "In Progress"
    await updateIssueStatus(linearClient, state.taskId, "In Progress");

    // Emit thought activity to show progress in Linear UI
    // Use sessionId (AgentSession ID) not taskId (Issue ID)
    await emitThought(
      linearClient,
      state.sessionId,
      `Starting work on: ${issue.title}`,
    );

    // Return state update
    return {
      taskDescription: `${issue.title}\n\n${issue.description || ""}`,
      status: "coding",
    };
  };
}
