/**
 * Receive Issue Node
 *
 * LangGraph node that receives and validates Linear issue from webhook payload.
 * Entry point for the dev-agent workflow.
 *
 * Validates:
 * - Issue has agent-ready label
 * - Issue has required fields (id, identifier, title)
 *
 * On success: Sets phase to "setup"
 * On failure: Sets phase to "failed" with error message
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:receive-issue",
});

/**
 * Node that receives and validates Linear issue from webhook payload.
 *
 * The issue should already be set in state from workflow input
 * (via createDevAgentInitialState). This node validates the issue
 * has the required agent-ready label before proceeding.
 */
export function receiveIssueNode() {
  return async function receiveIssue(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const nodeLogger = logger.child({ taskId: state.taskId });

    nodeLogger.info({ taskId: state.taskId }, "Receiving Linear issue");

    // Issue should already be set from workflow input
    if (!state.issue) {
      nodeLogger.error("No issue in state");
      return {
        phase: "failed",
        errorMessage: "No issue provided in workflow input",
      };
    }

    // Validate agent-ready label
    if (!state.issue.labels.includes("agent-ready")) {
      nodeLogger.warn(
        { labels: state.issue.labels },
        "Missing agent-ready label",
      );
      return {
        phase: "failed",
        errorMessage: "Issue does not have agent-ready label",
      };
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
