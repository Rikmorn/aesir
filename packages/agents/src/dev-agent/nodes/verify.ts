/**
 * Verify Node
 *
 * Runs full test suite and lint check before pushing.
 * This is the quality gate before creating a PR - ensures
 * all tests pass and code meets lint standards.
 *
 * Implements DEV-13 through DEV-14 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { DevContainerManager } from "@aesir/platform";
import { DEV_CONTAINER_TIMEOUTS } from "@aesir/platform";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:verify",
});

export interface VerifyNodeDeps {
  manager: DevContainerManager;
}

/**
 * Node that verifies code quality before pushing.
 *
 * Steps:
 * 1. Run full test suite
 * 2. Run lint check
 * 3. Push branch to remote
 *
 * On success: Sets phase to "creating_pr"
 * On failure: Sets phase to "escalated" (verification failures need human help)
 */
export function createVerifyNode(deps: VerifyNodeDeps) {
  const { manager } = deps;

  return async function verifyNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, branchName } = state;
    const nodeLogger = logger.child({ taskId });

    if (!branchName) {
      return {
        phase: "failed",
        errorMessage: "No branch name for verification",
      };
    }

    nodeLogger.info({ branchName }, "Running verification checks");

    try {
      // Step 1: Full test suite
      nodeLogger.debug("Running full test suite");
      const testResult = await manager.execute(taskId, {
        command: ["pnpm", "test"],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.test * 3, // Allow more time for full suite
      });

      if (testResult.exitCode !== 0) {
        nodeLogger.error(
          { output: testResult.stderr.slice(0, 500) },
          "Full test suite failed",
        );
        return {
          phase: "escalated",
          errorMessage: `Full test suite failed: ${testResult.stderr.slice(0, 200)}`,
        };
      }

      // Step 2: Lint check
      nodeLogger.debug("Running lint check");
      const lintResult = await manager.execute(taskId, {
        command: ["pnpm", "lint"],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.build,
      });

      if (lintResult.exitCode !== 0) {
        nodeLogger.error(
          { output: lintResult.stderr.slice(0, 500) },
          "Lint check failed",
        );
        return {
          phase: "escalated",
          errorMessage: `Lint check failed: ${lintResult.stderr.slice(0, 200)}`,
        };
      }

      // Step 3: Push branch
      nodeLogger.debug("Pushing branch to remote");
      const pushResult = await manager.execute(taskId, {
        command: ["git", "push", "-u", "origin", branchName],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.git * 2,
      });

      if (pushResult.exitCode !== 0) {
        nodeLogger.error(
          { output: pushResult.stderr.slice(0, 500) },
          "Push failed",
        );
        return {
          phase: "escalated",
          errorMessage: `Push failed: ${pushResult.stderr.slice(0, 200)}`,
        };
      }

      nodeLogger.info("Verification complete, proceeding to PR creation");

      return {
        phase: "creating_pr",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Verification failed");
      return {
        phase: "escalated",
        errorMessage: `Verification error: ${message}`,
      };
    }
  };
}
