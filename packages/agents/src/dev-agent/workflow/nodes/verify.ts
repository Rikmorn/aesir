/**
 * Verify Node
 *
 * Runs full test suite and lint check before pushing.
 * This is the quality gate before creating a PR - ensures
 * all tests pass and code meets lint standards.
 *
 * Implements DEV-13 through DEV-14 from the dev-agent workflow spec.
 */

import type { DevContainerManager } from "@aesir/platform";
import {
  createPinoLogger,
  DEV_CONTAINER_TIMEOUTS,
  type PinoLogger,
} from "@aesir/platform";
import {
  detectPackageManager,
  getLintCommand,
  getTestCommand,
} from "../../utils/index.js";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:verify",
});

/**
 * File extensions that don't require testing or linting.
 */
const NON_CODE_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".lock",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".prettierrc",
  ".eslintignore",
  ".dockerignore",
  "LICENSE",
  "CHANGELOG",
  "README",
];

function isNonCodeFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return NON_CODE_EXTENSIONS.some(
    (ext) =>
      lowerPath.endsWith(ext.toLowerCase()) ||
      lowerPath.includes(ext.toLowerCase()),
  );
}

function allFilesAreNonCode(files: string[]): boolean {
  return files.length > 0 && files.every(isNonCodeFile);
}

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
    const { taskId, branchName, executionPlan } = state;
    const nodeLogger = logger.child({ taskId });

    if (!branchName) {
      return {
        phase: "failed",
        errorMessage: "No branch name for verification",
      };
    }

    nodeLogger.info({ branchName }, "Running verification checks");

    // Check if this is a non-code-only change (e.g., README update)
    const allPlanFiles = executionPlan?.steps.flatMap((s) => s.files) ?? [];
    const isNonCodeOnlyChange = allFilesAreNonCode(allPlanFiles);

    if (isNonCodeOnlyChange) {
      nodeLogger.info(
        { files: allPlanFiles },
        "Non-code files only - skipping test suite and lint checks",
      );
    }

    try {
      // Only run tests and lint for code changes
      if (!isNonCodeOnlyChange) {
        // Detect package manager for this repo
        const pm = await detectPackageManager({ manager, taskId });
        nodeLogger.debug({ packageManager: pm }, "Detected package manager");

        // Step 1: Full test suite
        nodeLogger.debug("Running full test suite");
        const testResult = await manager.execute(taskId, {
          command: getTestCommand(pm),
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
          command: getLintCommand(pm),
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
      }

      // Push branch (always needed)
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
