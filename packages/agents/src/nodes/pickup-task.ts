/**
 * Pickup Task Node
 *
 * LangGraph node that reads a task from Linear and updates its status to "In Progress".
 * Uses factory pattern for dependency injection.
 *
 * This is the first node in the dev workflow - it initializes the state with
 * task details from Linear and signals that work has started.
 */

import type { DevWorkflowStateType } from "@aesir/common";
import { generateCorrelationId } from "@aesir/platform";
import { callMcpTool } from "../mcp/index.js";

const AGENT_ID = "dev-agent";

/**
 * Factory function to create the pickup task node.
 *
 * @returns LangGraph node function
 */
export function createPickupTaskNode() {
  /**
   * Pickup task node - reads task from Linear and updates status.
   *
   * @param state - Current workflow state with taskId
   * @returns Partial state update with task description and coding status
   */
  return async function pickupTaskNode(
    state: DevWorkflowStateType,
  ): Promise<Partial<DevWorkflowStateType>> {
    const correlationId = generateCorrelationId("agent");

    // Read task details from Linear via MCP
    const issue = await callMcpTool<{ title: string; description?: string }>({
      integration: "linear",
      tool: "get_issue",
      params: { issueId: state.taskId },
      agentId: AGENT_ID,
      correlationId,
    });

    // Update status to "In Progress" via MCP
    await callMcpTool({
      integration: "linear",
      tool: "update_issue_status",
      params: { issueId: state.taskId, statusName: "In Progress" },
      agentId: AGENT_ID,
      correlationId,
    });

    // TODO: emitThought requires MCP tool - add 'emit_thought' to Linear MCP
    // This is a UX feature that posts activity comments to Linear issues.
    // Original call: emitThought(linearClient, state.sessionId, `Starting work on: ${issue.title}`)
    // Context: Use sessionId (AgentSession ID) not taskId (Issue ID) when tool is added

    // Return state update
    return {
      taskDescription: `${issue.title}\n\n${issue.description || ""}`,
      status: "coding",
    };
  };
}
