/**
 * Linear Agent Activity Emitters
 *
 * Functions to emit agent activities to Linear's Agent Interaction SDK.
 * Activities appear in Linear's UI showing agent progress.
 */

import type { LinearClient } from "@linear/sdk";
import type { AgentPlanItem } from "../webhooks/types.js";

/**
 * Emit a thought activity - agent's reasoning process
 *
 * Use for internal reasoning visible to the user.
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to emit activity for
 * @param body - The thought message to display
 */
export async function emitThought(
  client: LinearClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "thought", body },
  });
}

/**
 * Emit an action activity - when agent performs an action
 *
 * Use for tool invocations (e.g., "Reading", "repository code").
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to emit activity for
 * @param action - What action is being taken (e.g., "Reading", "Creating")
 * @param parameter - What the action is targeting (e.g., "linked GitHub repository")
 */
export async function emitAction(
  client: LinearClient,
  sessionId: string,
  action: string,
  parameter: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "action", action, parameter },
  });
}

/**
 * Emit a response activity - agent's final response
 *
 * Use for final completion message when task is done.
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to emit activity for
 * @param body - The response message to display
 */
export async function emitResponse(
  client: LinearClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "response", body },
  });
}

/**
 * Emit an error activity - when agent encounters an error
 *
 * Use for failures that prevent task completion.
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to emit activity for
 * @param body - The error message to display
 */
export async function emitError(
  client: LinearClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "error", body },
  });
}

/**
 * Emit an elicitation activity - request clarification from user
 *
 * Use when agent needs more information to proceed.
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to emit activity for
 * @param body - The question or prompt for the user
 */
export async function emitElicitation(
  client: LinearClient,
  sessionId: string,
  body: string,
): Promise<void> {
  await client.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "elicitation", body },
  });
}

/**
 * Update the session plan with progress items
 *
 * Displays a checklist in Linear's UI showing multi-step task progress.
 * NOTE: Must replace entire array - cannot modify individual items.
 *
 * @param client - LinearClient instance with valid access token
 * @param sessionId - The agent session ID to update plan for
 * @param plan - Array of plan items with content and status
 */
export async function updateSessionPlan(
  client: LinearClient,
  sessionId: string,
  plan: AgentPlanItem[],
): Promise<void> {
  await client.updateAgentSession(sessionId, {
    plan: plan as unknown as Record<string, unknown>,
  });
}
