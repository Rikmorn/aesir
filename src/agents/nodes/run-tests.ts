/**
 * Run Tests Node
 *
 * LangGraph node that writes files to sandbox and executes tests.
 * Part of the Generator-Critic pattern where tests serve as the critic.
 *
 * Key design decisions:
 * - Sandbox injected via factory for testability
 * - Writes all files before running tests
 * - Returns TestResult from sandbox
 * - Updates testAttempts and status based on result
 */

import type { Sandbox, TestResult } from "../../sandbox/types.js";
import type {
  DevWorkflowStateType,
  DevWorkflowConfig,
} from "../../state/dev-workflow-state.js";
import { DEFAULT_DEV_WORKFLOW_CONFIG } from "../../state/dev-workflow-state.js";
import { logger } from "../../logging/index.js";

/**
 * Factory function that creates a runTestsNode with injected sandbox.
 *
 * @param sandbox - Sandbox instance for file operations and test execution
 * @returns LangGraph node function
 */
export function createRunTestsNode(sandbox: Sandbox) {
  return async function runTestsNode(
    state: DevWorkflowStateType,
    config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG
  ): Promise<Partial<DevWorkflowStateType>> {
    const nodeLogger = logger.child({ node: "run-tests" });

    const timing = nodeLogger.startTimer("run_tests", {
      context: {
        taskId: state.taskId,
        fileCount: state.files.length,
        testAttempts: state.testAttempts,
      },
      message: `Running tests for task: ${state.taskId}`,
    });

    try {
      // Write all files to sandbox
      for (const file of state.files) {
        if (file.operation !== "delete") {
          // Ensure parent directories exist
          const dir = file.path.substring(0, file.path.lastIndexOf("/"));
          if (dir) {
            await sandbox.execute(["mkdir", "-p", dir]);
          }
          await sandbox.writeFile(file.path, file.content);
        }
      }

      nodeLogger.info("files_written", {
        context: { fileCount: state.files.length },
        message: `Wrote ${state.files.length} file(s) to sandbox`,
      });

      // Run tests
      const testResult: TestResult = await sandbox.runTests(config.testCommand);

      const newTestAttempts = state.testAttempts + 1;
      const newStatus = testResult.passed ? "committing" : "fixing";

      nodeLogger.info("tests_executed", {
        context: {
          passed: testResult.passed,
          exitCode: testResult.exitCode,
          testAttempts: newTestAttempts,
          status: newStatus,
        },
        message: testResult.passed
          ? "Tests passed"
          : `Tests failed (attempt ${newTestAttempts})`,
      });

      timing.success({
        context: {
          passed: testResult.passed,
          testAttempts: newTestAttempts,
        },
        message: "Test execution completed",
      });

      return {
        testResult,
        testAttempts: newTestAttempts,
        status: newStatus,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during test execution";

      timing.failure({ message: errorMessage });

      return {
        status: "failed",
        error: errorMessage,
      };
    }
  };
}
