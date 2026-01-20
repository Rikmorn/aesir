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

import {
  createPinoLogger,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowConfig,
  type DevWorkflowStateType,
  type Sandbox,
  type TestResult,
} from "@aesir/common";

const logger = createPinoLogger({ component: "agents:nodes:run-tests" });

/**
 * Factory function that creates a runTestsNode with injected sandbox.
 *
 * @param sandbox - Sandbox instance for file operations and test execution
 * @returns LangGraph node function
 */
export function createRunTestsNode(sandbox: Sandbox) {
  return async function runTestsNode(
    state: DevWorkflowStateType,
    config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG,
  ): Promise<Partial<DevWorkflowStateType>> {
    const nodeLogger = logger.child({
      node: "run-tests",
      taskId: state.taskId,
    });
    const startTime = Date.now();

    nodeLogger.info(
      { fileCount: state.files.length, testAttempts: state.testAttempts },
      `Running tests for task: ${state.taskId}`,
    );

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

      nodeLogger.info(
        { fileCount: state.files.length },
        `Wrote ${state.files.length} file(s) to sandbox`,
      );

      // Run tests
      const testResult: TestResult = await sandbox.runTests(config.testCommand);

      const durationMs = Date.now() - startTime;
      const newTestAttempts = state.testAttempts + 1;
      const newStatus = testResult.passed ? "committing" : "fixing";

      nodeLogger.info(
        {
          passed: testResult.passed,
          exitCode: testResult.exitCode,
          testAttempts: newTestAttempts,
          status: newStatus,
          durationMs,
        },
        testResult.passed
          ? "Tests passed"
          : `Tests failed (attempt ${newTestAttempts})`,
      );

      return {
        testResult,
        testAttempts: newTestAttempts,
        status: newStatus,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during test execution";

      nodeLogger.error(
        { err: errorMessage, durationMs },
        "Test execution failed",
      );

      return {
        status: "failed",
        error: errorMessage,
      };
    }
  };
}
