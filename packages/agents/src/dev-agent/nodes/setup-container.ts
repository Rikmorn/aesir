/**
 * Setup Container Node
 *
 * LangGraph node that sets up the dev container environment with repository.
 *
 * Steps:
 * 1. Spawn or resume container
 * 2. Configure git credentials
 * 3. Clone repository (if fresh container)
 * 4. Create feature branch
 *
 * On success: Sets containerId, branchName, phase to "researching"
 * On failure: Sets phase to "failed" with error message
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { DevContainerGit, DevContainerManager } from "@aesir/platform";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:setup-container",
});

export interface SetupContainerNodeDeps {
  manager: DevContainerManager;
  git: DevContainerGit;
  repoUrl: string;
  githubToken: string;
}

/**
 * Create setup container node with injected dependencies.
 *
 * Uses factory pattern to inject DevContainerManager and DevContainerGit,
 * enabling testing with mocks and runtime configuration.
 *
 * @param deps - Dependencies for container setup
 * @returns Node function for LangGraph
 */
export function createSetupContainerNode(deps: SetupContainerNodeDeps) {
  const { manager, git, repoUrl, githubToken } = deps;

  return async function setupContainer(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue) {
      return {
        phase: "failed",
        errorMessage: "No issue in state for container setup",
      };
    }

    nodeLogger.info(
      { identifier: issue.identifier },
      "Setting up dev container",
    );

    try {
      // Step 1: Spawn or resume container
      const containerId = await manager.spawn({ taskId });
      nodeLogger.info(
        { containerId: containerId.slice(0, 12) },
        "Container ready",
      );

      // Step 2: Configure git credentials
      const credResult = await git.configureCredentials(taskId, githubToken);
      if (!credResult.success) {
        nodeLogger.error(
          { error: credResult.error },
          "Failed to configure credentials",
        );
        return {
          containerId,
          phase: "failed",
          errorMessage: `Git credential setup failed: ${credResult.error}`,
        };
      }

      // Step 3: Clone repository (cloneRepository handles if already cloned)
      const cloneResult = await git.cloneRepository(taskId, repoUrl);
      if (!cloneResult.success) {
        nodeLogger.error(
          { error: cloneResult.error },
          "Failed to clone repository",
        );
        return {
          containerId,
          phase: "failed",
          errorMessage: `Clone failed: ${cloneResult.error}`,
        };
      }

      // Step 4: Create feature branch
      const branchName = `feature/${issue.identifier}`;
      const branchResult = await git.createBranch(taskId, issue.identifier);
      if (!branchResult.success) {
        nodeLogger.error(
          { error: branchResult.error },
          "Failed to create branch",
        );
        return {
          containerId,
          phase: "failed",
          errorMessage: `Branch creation failed: ${branchResult.error}`,
        };
      }

      nodeLogger.info(
        { branchName },
        "Container setup complete, proceeding to research",
      );

      return {
        containerId,
        branchName,
        phase: "researching",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Container setup failed");
      return {
        phase: "failed",
        errorMessage: `Container setup error: ${message}`,
      };
    }
  };
}
