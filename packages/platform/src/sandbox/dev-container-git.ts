/**
 * Dev Container Git Operations
 *
 * Helpers for git operations inside dev containers.
 * Wraps git CLI commands executed via DevContainerManager.
 */

import type { PinoLogger } from "@aesir/platform";
import type { DevContainerManager } from "./dev-container.js";
import { DEV_CONTAINER_TIMEOUTS } from "./types.js";

/** Options for creating DevContainerGit */
export interface DevContainerGitOptions {
  manager: DevContainerManager;
  logger: PinoLogger;
}

/** Result of a git operation */
export interface GitOperationResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/** Dev container git operations interface */
export interface DevContainerGit {
  /**
   * Configure git credentials in container
   *
   * Uses credential helper 'store' with token file.
   * Must be called before clone/push operations.
   *
   * @param taskId - Task identifier (container lookup)
   * @param githubToken - GitHub personal access token or OAuth token
   */
  configureCredentials(
    taskId: string,
    githubToken: string,
  ): Promise<GitOperationResult>;

  /**
   * Clone repository into container
   *
   * Clones to /workspace/repo directory.
   * Configures git user name and email for commits.
   *
   * @param taskId - Task identifier (container lookup)
   * @param repoUrl - Repository URL (https://github.com/owner/repo)
   * @param options - Optional: branch to checkout, git user config
   */
  cloneRepository(
    taskId: string,
    repoUrl: string,
    options?: {
      branch?: string;
      gitUser?: { name: string; email: string };
    },
  ): Promise<GitOperationResult>;

  /**
   * Create feature branch
   *
   * Creates and checks out feature/{issueId} branch.
   *
   * @param taskId - Task identifier (container lookup)
   * @param issueId - Issue identifier (used for branch name)
   * @param baseBranch - Branch to base off (default: main)
   */
  createBranch(
    taskId: string,
    issueId: string,
    baseBranch?: string,
  ): Promise<GitOperationResult>;

  /**
   * Get current branch name
   */
  getCurrentBranch(taskId: string): Promise<string | null>;

  /**
   * Check if repository is clean (no uncommitted changes)
   */
  isClean(taskId: string): Promise<boolean>;
}

/**
 * Create dev container git operations
 */
export function createDevContainerGit(
  options: DevContainerGitOptions,
): DevContainerGit {
  const { manager, logger } = options;

  if (!manager) throw new Error("manager is required for DevContainerGit");
  if (!logger) throw new Error("logger is required for DevContainerGit");

  const REPO_PATH = "/workspace/repo";
  const CREDENTIALS_FILE = "/tmp/.git-credentials";
  const GIT_TIMEOUT = DEV_CONTAINER_TIMEOUTS.git;

  /**
   * Execute git command
   */
  async function execGit(
    taskId: string,
    args: string[],
    workdir: string = REPO_PATH,
  ): Promise<GitOperationResult> {
    const command = ["git", ...args];

    try {
      const result = await manager.execute(taskId, {
        command,
        workdir,
        timeoutMs: GIT_TIMEOUT,
      });

      if (result.timedOut) {
        return {
          success: false,
          stdout: result.stdout,
          stderr: result.stderr,
          error: "Git command timed out",
        };
      }

      if (result.exitCode === 0) {
        return {
          success: true,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
      return {
        success: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.stderr,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        stdout: "",
        stderr: error,
        error,
      };
    }
  }

  return {
    async configureCredentials(
      taskId: string,
      githubToken: string,
    ): Promise<GitOperationResult> {
      logger.info({ taskId }, "Configuring git credentials");

      // Write credentials file
      // Format: https://oauth2:TOKEN@github.com
      const credContent = `https://oauth2:${githubToken}@github.com`;

      const writeResult = await manager.execute(taskId, {
        command: [
          "sh",
          "-c",
          `echo '${credContent}' > ${CREDENTIALS_FILE} && chmod 600 ${CREDENTIALS_FILE}`,
        ],
        workdir: "/workspace",
        timeoutMs: GIT_TIMEOUT,
      });

      if (writeResult.exitCode !== 0) {
        return {
          success: false,
          stdout: writeResult.stdout,
          stderr: writeResult.stderr,
          error: "Failed to write credentials file",
        };
      }

      // Configure credential helper
      const configResult = await manager.execute(taskId, {
        command: [
          "git",
          "config",
          "--global",
          "credential.helper",
          `store --file=${CREDENTIALS_FILE}`,
        ],
        workdir: "/workspace",
        timeoutMs: GIT_TIMEOUT,
      });

      if (configResult.exitCode !== 0) {
        return {
          success: false,
          stdout: configResult.stdout,
          stderr: configResult.stderr,
          error: "Failed to configure credential helper",
        };
      }

      logger.info({ taskId }, "Git credentials configured");

      return {
        success: true,
        stdout: "",
        stderr: "",
      };
    },

    async cloneRepository(
      taskId: string,
      repoUrl: string,
      options?: {
        branch?: string;
        gitUser?: { name: string; email: string };
      },
    ): Promise<GitOperationResult> {
      const { branch, gitUser } = options ?? {};

      logger.info({ taskId, repoUrl, branch }, "Cloning repository");

      // Build clone command
      const cloneArgs = ["clone"];
      if (branch) {
        cloneArgs.push("--branch", branch);
      }
      cloneArgs.push("--depth", "1"); // Shallow clone for speed
      cloneArgs.push(repoUrl, REPO_PATH);

      const cloneResult = await execGit(taskId, cloneArgs, "/workspace");

      if (!cloneResult.success) {
        logger.error(
          { taskId, error: cloneResult.error },
          "Failed to clone repository",
        );
        return cloneResult;
      }

      // Configure git user if provided
      if (gitUser) {
        await execGit(taskId, ["config", "user.name", gitUser.name]);
        await execGit(taskId, ["config", "user.email", gitUser.email]);
      } else {
        // Default user for agent commits
        await execGit(taskId, ["config", "user.name", "Aesir Dev Agent"]);
        await execGit(taskId, ["config", "user.email", "dev-agent@aesir.dev"]);
      }

      logger.info({ taskId }, "Repository cloned successfully");

      return cloneResult;
    },

    async createBranch(
      taskId: string,
      issueId: string,
      baseBranch: string = "main",
    ): Promise<GitOperationResult> {
      const branchName = `feature/${issueId}`;

      logger.info(
        { taskId, branchName, baseBranch },
        "Creating feature branch",
      );

      // Fetch latest from origin first
      const fetchResult = await execGit(taskId, [
        "fetch",
        "origin",
        baseBranch,
      ]);
      if (!fetchResult.success) {
        logger.warn(
          { taskId, error: fetchResult.error },
          "Fetch failed, continuing with local state",
        );
      }

      // Create and checkout branch
      const branchResult = await execGit(taskId, [
        "checkout",
        "-b",
        branchName,
        `origin/${baseBranch}`,
      ]);

      if (!branchResult.success) {
        // Maybe branch already exists, try to checkout
        const checkoutResult = await execGit(taskId, ["checkout", branchName]);
        if (!checkoutResult.success) {
          logger.error(
            { taskId, error: branchResult.error },
            "Failed to create branch",
          );
          return branchResult;
        }
      }

      logger.info({ taskId, branchName }, "Feature branch created");

      return { success: true, stdout: "", stderr: "" };
    },

    async getCurrentBranch(taskId: string): Promise<string | null> {
      const result = await execGit(taskId, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      if (!result.success) return null;
      return result.stdout.trim();
    },

    async isClean(taskId: string): Promise<boolean> {
      const result = await execGit(taskId, ["status", "--porcelain"]);
      if (!result.success) return false;
      return result.stdout.trim() === "";
    },
  };
}
