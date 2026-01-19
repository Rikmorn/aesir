/**
 * Dev Agent Temporal Activity
 *
 * Wraps the LangGraph dev workflow as a Temporal activity.
 * This allows the workflow to be executed with Temporal's
 * retry, timeout, and monitoring capabilities.
 */

import {
  runDevWorkflow,
  type DevWorkflowResult,
  type DevWorkflowDependencies,
} from "../../agents/dev-workflow-runner.js";
import { createLogger } from "../../logging/logger.js";

const logger = createLogger({
  defaultContext: { module: "temporal-activity-dev-agent" },
});

/**
 * Run the dev agent workflow as a Temporal activity.
 *
 * NOTE: This activity will run the entire LangGraph workflow inside.
 * Configure with appropriate startToCloseTimeout (e.g., 30 minutes).
 *
 * @param taskId - Linear Issue ID
 * @param sessionId - Linear AgentSession ID for emitting activities
 * @param deps - Dev workflow dependencies (pre-configured)
 * @returns Dev workflow result with PR number if successful
 */
export async function executeDevWorkflow(
  taskId: string,
  sessionId: string,
  deps: DevWorkflowDependencies
): Promise<DevWorkflowResult> {
  logger.info("activity_dev_workflow_start", {
    message: `Executing dev workflow for task ${taskId}`,
    context: { taskId, sessionId },
  });

  const result = await runDevWorkflow(taskId, sessionId, deps);

  logger.info("activity_dev_workflow_complete", {
    outcome: result.success ? "success" : "failure",
    message: `Dev workflow ${result.success ? "completed" : "failed"} for task ${taskId}`,
    context: { taskId, status: result.status, prNumber: result.prNumber },
  });

  return result;
}
