/**
 * Dev Container Cleanup Service
 *
 * Handles container lifecycle cleanup:
 * - Task completion: immediate cleanup
 * - Inactivity timeout: 24h cleanup via scheduled job
 */

import type { PinoLogger } from "@aesir/common";
import type { Container } from "dockerode";
import Docker from "dockerode";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDevContainerStore } from "./dev-container-store.js";

/** 24 hours in milliseconds */
const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** 10 seconds graceful shutdown timeout */
const STOP_TIMEOUT_SECONDS = 10;

/** Default cleanup interval: 1 hour */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Options for creating DevContainerCleanup */
export interface DevContainerCleanupOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
  /** Docker client instance (for testing) */
  docker?: Docker;
  /** Inactivity timeout in ms (default: 24h) */
  inactivityTimeoutMs?: number;
}

/** Result of a cleanup operation */
export interface CleanupResult {
  success: boolean;
  taskId: string;
  containerId?: string | undefined;
  error?: string | undefined;
}

/** Dev container cleanup interface */
export interface DevContainerCleanup {
  /**
   * Cleanup a specific container by task ID
   *
   * Stops container gracefully (10s timeout), then force kills if needed.
   * Removes container and deletes database record.
   *
   * @param taskId - Task identifier
   * @returns Cleanup result
   */
  cleanupContainer(taskId: string): Promise<CleanupResult>;

  /**
   * Cleanup all inactive containers
   *
   * Finds containers with last_activity older than inactivity timeout.
   * Cleans up each one.
   *
   * @returns Array of cleanup results
   */
  cleanupInactive(): Promise<CleanupResult[]>;

  /**
   * Start cleanup scheduler
   *
   * Runs cleanupInactive() on interval.
   * Returns function to stop scheduler.
   *
   * @param intervalMs - Cleanup interval (default: 1 hour)
   * @returns Stop function
   */
  startCleanupScheduler(intervalMs?: number): () => void;

  /** Cleanup resources */
  close(): Promise<void>;
}

/**
 * Create dev container cleanup service
 */
export function createDevContainerCleanup(
  options: DevContainerCleanupOptions,
): DevContainerCleanup {
  const { db, logger } = options;
  const docker = options.docker ?? new Docker();
  const inactivityTimeoutMs =
    options.inactivityTimeoutMs ?? INACTIVITY_TIMEOUT_MS;

  if (!db) throw new Error("db is required for DevContainerCleanup");
  if (!logger) throw new Error("logger is required for DevContainerCleanup");

  const store = createDevContainerStore({ db, logger });

  let schedulerInterval: NodeJS.Timeout | null = null;

  /**
   * Get container name for a task
   */
  function getContainerName(taskId: string): string {
    return `dev-container-${taskId}`;
  }

  /**
   * Find Docker container by name
   */
  async function findContainerByName(name: string): Promise<Container | null> {
    try {
      const container = docker.getContainer(name);
      await container.inspect(); // Verify exists
      return container;
    } catch {
      return null;
    }
  }

  /**
   * Stop and remove a container
   */
  async function removeContainer(
    container: Container,
    taskId: string,
  ): Promise<void> {
    const containerId = container.id.slice(0, 12);

    try {
      // Try graceful stop first
      logger.debug({ taskId, containerId }, "Stopping container gracefully");
      await container.stop({ t: STOP_TIMEOUT_SECONDS });
    } catch (err) {
      // Container might already be stopped or not running
      logger.debug(
        { taskId, containerId, err },
        "Graceful stop failed, trying force kill",
      );
      try {
        await container.kill();
      } catch {
        // Container might already be stopped
      }
    }

    // Remove container
    try {
      await container.remove();
      logger.info({ taskId, containerId }, "Container removed");
    } catch (err) {
      logger.warn({ taskId, containerId, err }, "Failed to remove container");
      throw err;
    }
  }

  return {
    async cleanupContainer(taskId: string): Promise<CleanupResult> {
      const containerName = getContainerName(taskId);

      logger.info({ taskId }, "Cleaning up container");

      // Get record from database
      const record = await store.getByTaskId(taskId);

      // Find container
      const container = await findContainerByName(containerName);

      if (container) {
        try {
          await removeContainer(container, taskId);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          logger.error({ taskId, error }, "Failed to remove container");

          // Still try to clean up database record
          await store.delete(taskId);

          return {
            success: false,
            taskId,
            containerId: record?.container_id,
            error,
          };
        }
      } else {
        logger.debug(
          { taskId },
          "Container not found, cleaning up database record only",
        );
      }

      // Delete database record
      await store.delete(taskId);

      return {
        success: true,
        taskId,
        containerId: record?.container_id,
      };
    },

    async cleanupInactive(): Promise<CleanupResult[]> {
      logger.info(
        { inactivityTimeoutMs },
        "Running inactive container cleanup",
      );

      const inactiveContainers = await store.findInactive(inactivityTimeoutMs);

      logger.info(
        { count: inactiveContainers.length },
        "Found inactive containers",
      );

      const results: CleanupResult[] = [];

      for (const record of inactiveContainers) {
        const result = await this.cleanupContainer(record.task_id);
        results.push(result);
      }

      const successCount = results.filter((r) => r.success).length;
      logger.info(
        { total: results.length, success: successCount },
        "Inactive cleanup complete",
      );

      return results;
    },

    startCleanupScheduler(
      intervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS,
    ): () => void {
      logger.info({ intervalMs }, "Starting cleanup scheduler");

      schedulerInterval = setInterval(async () => {
        try {
          await this.cleanupInactive();
        } catch (err) {
          logger.error({ err }, "Cleanup scheduler error");
        }
      }, intervalMs);

      // Return stop function
      return () => {
        if (schedulerInterval) {
          clearInterval(schedulerInterval);
          schedulerInterval = null;
          logger.info("Cleanup scheduler stopped");
        }
      };
    },

    async close(): Promise<void> {
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
      }
      await store.close();
    },
  };
}
