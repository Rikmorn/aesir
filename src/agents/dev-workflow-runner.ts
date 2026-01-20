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

import { emitError, updateIssueStatus } from "../integrations/linear/index.js";
import {
  createLogger,
  createTraceStore,
  type LogEntry,
} from "../logging/index.js";
import {
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowConfig,
} from "../state/dev-workflow-state.js";
import {
  createDevWorkflow,
  type DevWorkflowDependencies,
} from "./dev-workflow.js";
import { createLangGraphTracer } from "./tracing/index.js";

const logger = createLogger({
  defaultContext: { module: "dev-workflow-runner" },
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
  const traceStore = createTraceStore();
  const taskLogger = logger.child({ taskId });
  const tracer = createLangGraphTracer(taskLogger, traceStore);

  logger.info("dev_workflow_start", {
    message: `Starting dev workflow for task ${taskId}`,
    context: { taskId },
  });

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

    logger.info("dev_workflow_complete", {
      outcome: "success",
      message: `Dev workflow completed for task ${taskId}`,
      context: { taskId, status: result.status },
      durationMs,
    });

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

    logger.error("dev_workflow_error", {
      outcome: "failure",
      message: `Dev workflow failed for task ${taskId}: ${errorMessage}`,
      context: { taskId, error: errorMessage },
      durationMs,
    });

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
      logger.warn("dev_workflow_linear_update_failed", {
        message: "Failed to update Linear status on workflow failure",
        context: {
          taskId,
          error:
            linearError instanceof Error
              ? linearError.message
              : String(linearError),
        },
      });
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
    logger.debug("dev_workflow_cleanup", {
      message: `Cleaning up sandbox for task ${taskId}`,
      context: { taskId },
    });

    try {
      await deps.sandbox.cleanup();
      logger.debug("dev_workflow_cleanup_complete", {
        message: `Sandbox cleanup complete for task ${taskId}`,
        context: { taskId },
      });
    } catch (cleanupError) {
      // Log but don't throw - cleanup failure shouldn't mask original error
      logger.error("dev_workflow_cleanup_failed", {
        outcome: "failure",
        message: "Sandbox cleanup failed",
        context: {
          taskId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        },
      });
    }
  }
}

// Re-export types for convenience
export type { DevWorkflowDependencies } from "./dev-workflow.js";
