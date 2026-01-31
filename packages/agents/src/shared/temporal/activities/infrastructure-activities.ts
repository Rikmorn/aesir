/**
 * Infrastructure Temporal Activities
 *
 * Lightweight activities for container lifecycle and task completion that
 * operate independently from the expensive LLM-driven orchestrator loop.
 *
 * 1. setupContainerActivity - Spawn container, configure git, clone repo
 * 2. stopContainerActivity - Stop and clean up container on timeout/completion
 * 3. completeTaskActivity - Mark task as complete/failed in the task store
 *
 * Shares dependencies with orchestrator activities via getOrchestratorDeps().
 * The worker calls initOrchestratorActivities() once and both files use the
 * same deps instance.
 *
 * These activities have different retry characteristics than orchestrator
 * activities (shorter timeouts, more retries) and should use separate
 * proxyActivities configuration in the workflow.
 */

import { getOrchestratorDeps } from "./orchestrator-activities.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for setting up a dev container.
 */
export interface SetupContainerInput {
  /** External task ID */
  taskId: string;
  /** Issue context for logging */
  issue: {
    identifier: string;
    title: string;
  };
  /** Temporal workflow ID for task store association */
  workflowId: string;
}

/**
 * Output from container setup.
 */
export interface SetupContainerOutput {
  /** Docker container ID */
  containerId: string;
}

/**
 * Input for completing a task.
 */
export interface CompleteTaskInput {
  /** External task ID */
  taskId: string;
  /** Whether the task completed successfully */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Activity: Setup Container
// ---------------------------------------------------------------------------

/**
 * Set up a dev container for agent code execution.
 *
 * Handles the infrastructure setup sequence:
 * 1. Spawn a Docker dev container
 * 2. Configure git credentials for GitHub access
 * 3. Clone the repository at the base branch
 * 4. Store the container ID in the task store
 *
 * Branch creation is left to the orchestrator via its github_create_branch
 * tool (research recommendation: separate infrastructure from reasoning).
 *
 * @param input - Container setup input with task and issue context
 * @returns Container ID for later cleanup
 */
export async function setupContainerActivity(
  input: SetupContainerInput,
): Promise<SetupContainerOutput> {
  const deps = getOrchestratorDeps();
  const activityLogger = deps.logger.child({
    activity: "setupContainerActivity",
    taskId: input.taskId,
  });

  activityLogger.info(
    { issueIdentifier: input.issue.identifier },
    "Setting up dev container",
  );

  // 0. Create task record (idempotent — ignores duplicate on activity retry)
  try {
    await deps.taskStore.createTask({
      taskId: input.taskId,
      agentType: "dev",
      issueIdentifier: input.issue.identifier,
      workflowId: input.workflowId,
    });
    activityLogger.info("Task record created");
  } catch (error) {
    // Unique constraint violation on task_id — task already exists (activity retry)
    const isDuplicate =
      error instanceof Error &&
      (error.message.includes("unique") ||
        error.message.includes("duplicate") ||
        error.message.includes("23505"));
    if (isDuplicate) {
      activityLogger.info("Task record already exists (activity retry)");
    } else {
      throw error;
    }
  }

  // 1. Spawn container
  const containerId = await deps.containerManager.spawn({
    taskId: input.taskId,
  });

  activityLogger.info(
    { containerId: containerId.slice(0, 12) },
    "Container spawned",
  );

  // 2. Configure git credentials
  const credResult = await deps.git.configureCredentials(
    input.taskId,
    deps.githubToken,
  );

  if (!credResult.success) {
    activityLogger.error(
      { error: credResult.error },
      "Failed to configure git credentials",
    );
    throw new Error(`Failed to configure git credentials: ${credResult.error}`);
  }

  activityLogger.info("Git credentials configured");

  // 3. Clone repository at base branch
  const cloneResult = await deps.git.cloneRepository(
    input.taskId,
    deps.repoUrl,
    { branch: deps.baseBranch },
  );

  if (!cloneResult.success) {
    activityLogger.error(
      { error: cloneResult.error },
      "Failed to clone repository",
    );
    throw new Error(`Failed to clone repository: ${cloneResult.error}`);
  }

  activityLogger.info({ branch: deps.baseBranch }, "Repository cloned");

  // 4. Store container ID and workflow ID in task store
  await deps.taskStore.updateTask(input.taskId, {
    containerId,
    workflowId: input.workflowId,
  });

  activityLogger.info(
    { containerId: containerId.slice(0, 12) },
    "Container setup complete",
  );

  return { containerId };
}

// ---------------------------------------------------------------------------
// Activity: Stop Container
// ---------------------------------------------------------------------------

/**
 * Stop and clean up a dev container.
 *
 * Called on workflow timeout, completion, or error to release container
 * resources. Looks up the container ID from the task store.
 *
 * Fails gracefully: if container is already stopped or not found, logs
 * a warning but does not throw (non-critical cleanup).
 *
 * @param taskId - External task ID identifying the container
 */
export async function stopContainerActivity(taskId: string): Promise<void> {
  const deps = getOrchestratorDeps();
  const activityLogger = deps.logger.child({
    activity: "stopContainerActivity",
    taskId,
  });

  activityLogger.info("Stopping dev container");

  // Look up container ID from task store
  const task = await deps.taskStore.getTask(taskId);
  const containerId = task?.container_id;

  if (!containerId) {
    activityLogger.warn(
      "No container ID found in task store - container may already be cleaned up",
    );
    return;
  }

  try {
    await deps.cleanup.cleanupContainer(taskId);
    activityLogger.info(
      { containerId: containerId.slice(0, 12) },
      "Container stopped and cleaned up",
    );
  } catch (error) {
    // Non-critical: container may already be stopped/removed
    activityLogger.warn(
      { err: error, containerId: containerId.slice(0, 12) },
      "Failed to stop container - may already be cleaned up",
    );
  }
}

// ---------------------------------------------------------------------------
// Activity: Complete Task
// ---------------------------------------------------------------------------

/**
 * Mark a task as complete or failed in the task store.
 *
 * Final lifecycle activity that updates the task status. Called at the
 * end of a workflow regardless of success or failure.
 *
 * @param input - Task completion input with success flag
 */
export async function completeTaskActivity(
  input: CompleteTaskInput,
): Promise<void> {
  const deps = getOrchestratorDeps();
  const activityLogger = deps.logger.child({
    activity: "completeTaskActivity",
    taskId: input.taskId,
  });

  const status = input.success ? "complete" : "failed";

  await deps.taskStore.updateTask(input.taskId, { status });

  activityLogger.info(
    { success: input.success, status },
    "Task marked as %s",
    status,
  );
}
