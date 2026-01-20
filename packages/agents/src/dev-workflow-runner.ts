/**
 * Dev Workflow Runner
 *
 * High-level function to run the dev workflow with proper lifecycle management.
 * Handles:
 * - Workflow invocation with initial state
 * - Error handling and Linear status updates on failure
 * - Sandbox cleanup in finally block (always runs)
 * - Result formatting
 * - LangGraph event tracing for debugging
 *
 * This is the primary entry point for running the Dev Agent workflow.
 */

import {
  createLogger,
  createPinoLogger,
  createTraceStore,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowConfig,
  type LogEntry,
  type PinoLogger,
} from "@aesir/common";
import { emitError, updateIssueStatus } from "@aesir/integrations";
import {
  createDevWorkflow,
  type DevWorkflowDependencies,
} from "./dev-workflow.js";
import { createLangGraphTracer } from "./tracing/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-workflow",
});

// TODO(12-05): Remove after tracer is migrated to pino in Task 3
// Legacy logger for LangGraph tracer compatibility - tracer uses old Logger API
const tracerLogger = createLogger({
  defaultContext: { component: "agents:dev-workflow:tracer" },
});

/**
 * Result of running the dev workflow
 */
export interface DevWorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** PR number if PR was created */
  prNumber?: number;
  /** Final workflow status */
  status: string;
  /** Error message if workflow failed */
  error?: string;
  /** Total workflow duration in milliseconds */
  durationMs: number;
  /** Workflow execution traces for debugging */
  traces?: LogEntry[];
}

/**
 * Run the complete dev workflow for a task.
 *
 * This function:
 * 1. Creates the workflow with injected dependencies
 * 2. Invokes the workflow with initial state
 * 3. Handles errors by updating Linear status
 * 4. ALWAYS cleans up sandbox in finally block
 * 5. Returns structured result
 *
 * @param taskId - Linear Issue ID to work on
 * @param sessionId - Linear AgentSession ID for emitting activities
 * @param deps - All workflow dependencies (Linear, GitHub, Sandbox)
 * @param config - Optional workflow configuration
 * @returns Workflow result with success status and optional PR number
 */
export async function runDevWorkflow(
  taskId: string,
  sessionId: string,
  deps: DevWorkflowDependencies,
  config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG,
): Promise<DevWorkflowResult> {
  const startTime = Date.now();

  // Create trace store and tracer for this workflow run
  // TODO(12-05): Use pino logger after tracer is migrated in Task 3
  const traceStore = createTraceStore();
  const taskTracerLogger = tracerLogger.child({ taskId });
  const tracer = createLangGraphTracer(taskTracerLogger, traceStore);

  logger.info({ taskId }, `Starting dev workflow for task ${taskId}`);

  try {
    // Create the workflow with all dependencies
    const workflow = createDevWorkflow({ deps, config });

    // Invoke the workflow with initial state and tracer callbacks
    const result = await workflow.invoke(
      { taskId, sessionId, status: "pending" },
      {
        configurable: { thread_id: taskId },
        recursionLimit: config.recursionLimit,
        callbacks: [tracer],
      },
    );

    const durationMs = Date.now() - startTime;

    logger.info(
      { taskId, status: result.status, durationMs },
      `Dev workflow completed for task ${taskId}`,
    );

    // Build result with conditional prNumber to satisfy exactOptionalPropertyTypes
    const workflowResult: DevWorkflowResult = {
      success: result.status === "complete",
      status: result.status,
      durationMs,
      traces: traceStore.getByTaskId(taskId),
    };
    if (result.prNumber != null) {
      workflowResult.prNumber = result.prNumber;
    }
    return workflowResult;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      { taskId, err: errorMessage, durationMs },
      `Dev workflow failed for task ${taskId}: ${errorMessage}`,
    );

    // Update Linear status to indicate failure
    try {
      await updateIssueStatus(deps.linearClient, taskId, "Ready");
      await emitError(
        deps.linearClient,
        sessionId, // Use sessionId for agent activities, not taskId
        `Dev workflow failed: ${errorMessage}`,
      );
    } catch (linearError) {
      // Log but don't throw - we want to return the original error
      logger.warn(
        {
          taskId,
          err:
            linearError instanceof Error
              ? linearError.message
              : String(linearError),
        },
        "Failed to update Linear status on workflow failure",
      );
    }

    return {
      success: false,
      status: "failed",
      error: errorMessage,
      durationMs,
      traces: traceStore.getByTaskId(taskId),
    };
  } finally {
    // ALWAYS clean up sandbox, regardless of success or failure
    logger.debug({ taskId }, `Cleaning up sandbox for task ${taskId}`);

    try {
      await deps.sandbox.cleanup();
      logger.debug({ taskId }, `Sandbox cleanup complete for task ${taskId}`);
    } catch (cleanupError) {
      // Log but don't throw - cleanup failure shouldn't mask original error
      logger.error(
        {
          taskId,
          err:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        },
        "Sandbox cleanup failed",
      );
    }
  }
}

// Re-export types for convenience
export type { DevWorkflowDependencies } from "./dev-workflow.js";
