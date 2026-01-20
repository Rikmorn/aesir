/**
 * Dev Agent Temporal Activity
 *
 * Wraps the LangGraph dev workflow as a Temporal activity.
 * This allows the workflow to be executed with Temporal's
 * retry, timeout, and monitoring capabilities.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import {
  type DevWorkflowDependencies,
  type DevWorkflowResult,
  runDevWorkflow,
} from "../../dev-workflow-runner.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:dev-agent-activity",
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
  deps: DevWorkflowDependencies,
): Promise<DevWorkflowResult> {
  logger.info(
    { taskId, sessionId },
    `Executing dev workflow for task ${taskId}`,
  );

  const result = await runDevWorkflow(taskId, sessionId, deps);

  logger.info(
    {
      taskId,
      status: result.status,
      prNumber: result.prNumber,
      success: result.success,
    },
    `Dev workflow ${result.success ? "completed" : "failed"} for task ${taskId}`,
  );

  return result;
}
