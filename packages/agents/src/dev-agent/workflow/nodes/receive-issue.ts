/**
 * Receive Issue Node
 *
 * LangGraph node that receives and validates Linear issue from webhook payload.
 * Entry point for the dev-agent workflow.
 *
 * Validates:
 * - Issue has required fields (id, identifier, title)
 *
 * Note: Label filtering is NOT done here. The workflow is triggered by
 * AgentSession events (when agent is assigned to issue in Linear).
 *
 * On success: Sets phase to "setup"
 * On failure: Sets phase to "failed" with error message
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:receive-issue",
});

/**
 * Resume phases that should be preserved (not overwritten to "setup").
 * These are phases where Temporal re-invokes the graph after a signal.
 */
const RESUME_PHASES = new Set(["executing", "addressing_feedback"]);

/**
 * Node that receives and validates Linear issue from webhook payload.
 *
 * The issue should already be set in state from workflow input
 * (via createDevAgentInitialState). This node validates the issue
 * has required fields before proceeding.
 *
 * Note: No label filtering - workflow is triggered by AgentSession
 * (agent assignment in Linear), not by label.
 *
 * Resume handling: When Temporal re-invokes the graph after approval
 * or feedback signals, the phase will already be set to "executing"
 * or "addressing_feedback". This node preserves those phases.
 */
export function receiveIssueNode() {
  return async function receiveIssue(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const nodeLogger = logger.child({ taskId: state.taskId });

    nodeLogger.info(
      { taskId: state.taskId, currentPhase: state.phase },
      "Receiving Linear issue",
    );

    // Issue should already be set from workflow input
    if (!state.issue) {
      nodeLogger.error("No issue in state");
      return {
        phase: "failed",
        errorMessage: "No issue provided in workflow input",
      };
    }

    // Validate required fields
    if (!state.issue.id || !state.issue.identifier || !state.issue.title) {
      nodeLogger.error(
        { issue: state.issue },
        "Issue missing required fields (id, identifier, title)",
      );
      return {
        phase: "failed",
        errorMessage: "Issue missing required fields",
      };
    }

    // Check if this is a resume (Temporal re-invocation after signal)
    if (RESUME_PHASES.has(state.phase)) {
      nodeLogger.info(
        { identifier: state.issue.identifier, phase: state.phase },
        "Resuming workflow from signal, preserving phase",
      );
      // Return empty update to preserve current phase
      return {};
    }

    nodeLogger.info(
      { identifier: state.issue.identifier, title: state.issue.title },
      "Issue validated, proceeding to setup",
    );

    return {
      phase: "setup",
    };
  };
}
