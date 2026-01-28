/**
 * Dev Container Manager
 *
 * Manages persistent dev containers for agent code execution.
 * Handles container lifecycle: spawn, execute, resume, cleanup.
 *
 * Uses dockerode for Docker API and database store for state tracking.
 */

import type { PinoLogger } from "@aesir/platform";
import type { Container } from "dockerode";
import Docker from "dockerode";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDevContainerStore } from "./dev-container-store.js";
import {
  DEV_CONTAINER_TIMEOUTS,
  type DevContainerExecOptions,
  type DevContainerExecResult,
  type DevContainerSpawnOptions,
} from "./types.js";

/** Default dev environment image */
const DEFAULT_IMAGE = "aesir-dev-env:latest";

/** Options for creating DevContainerManager */
export interface DevContainerManagerOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
  /** Docker client instance (for testing) */
  docker?: Docker;
}

/** Dev container manager interface */
export interface DevContainerManager {
  /**
   * Spawn a new dev container or resume existing one
   *
   * Creates named container (dev-container-{taskId}).
   * If container exists and is running, reuses it.
   * If container exists but stopped, removes and recreates.
   *
   * @returns Container ID (Docker's full 64-char ID)
   */
  spawn(options: DevContainerSpawnOptions): Promise<string>;

  /**
   * Execute a command in a dev container
   *
   * Finds container by taskId and executes command.
   * Updates last_activity timestamp on each call.
   *
   * @throws Error if container not found for taskId
   */
  execute(
    taskId: string,
    options: DevContainerExecOptions,
  ): Promise<DevContainerExecResult>;

  /**
   * Find container by task ID
   *
   * Returns container ID if found and running, null otherwise.
   */
  findByTaskId(taskId: string): Promise<string | null>;

  /**
   * Check if container exists and is running
   */
  isRunning(taskId: string): Promise<boolean>;

  /** Health check */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /** Cleanup resources */
  close(): Promise<void>;
}

/**
 * Create dev container manager
 */
export function createDevContainerManager(
  options: DevContainerManagerOptions,
): DevContainerManager {
  const { db, logger } = options;
  const docker = options.docker ?? new Docker();

  if (!db) throw new Error("db is required for DevContainerManager");
  if (!logger) throw new Error("logger is required for DevContainerManager");

  const store = createDevContainerStore({ db, logger });

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
   * Demux Docker stream to stdout/stderr
   */
  function demuxStream(
    stream: NodeJS.ReadableStream,
    dockerInstance: Docker,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      // Cast to any to match Container.modem type (modem: any in @types/dockerode)
      // biome-ignore lint/complexity/noBannedTypes: dockerode runtime accepts simple write objects
      (dockerInstance.modem as { demuxStream: Function }).demuxStream(
        stream,
        { write: (chunk: Buffer) => stdout.push(chunk.toString()) },
        { write: (chunk: Buffer) => stderr.push(chunk.toString()) },
      );

      stream.on("end", () => {
        resolve({
          stdout: stdout.join(""),
          stderr: stderr.join(""),
        });
      });

      stream.on("error", reject);
    });
  }

  return {
    async spawn(options: DevContainerSpawnOptions): Promise<string> {
      const { taskId, image = DEFAULT_IMAGE, environment = {} } = options;
      const containerName = getContainerName(taskId);

      logger.info({ taskId, image, containerName }, "Spawning dev container");

      // Check for existing container
      const existing = await findContainerByName(containerName);

      if (existing) {
        try {
          const inspect = await existing.inspect();

          if (inspect.State.Running) {
            logger.info(
              { taskId, containerId: inspect.Id.slice(0, 12) },
              "Reusing existing running container",
            );
            // Update activity in DB
            await store.updateActivity(taskId);
            return inspect.Id;
          }

          // Container exists but not running - remove it
          logger.info(
            { taskId, containerId: inspect.Id.slice(0, 12) },
            "Removing stopped container",
          );
          await existing.remove();
          await store.delete(taskId);
        } catch (err) {
          logger.warn(
            { err, taskId },
            "Error checking existing container, will create new",
          );
        }
      }

      // Create new container
      const container = await docker.createContainer({
        name: containerName,
        Image: image,
        Cmd: ["sleep", "infinity"],
        Tty: false, // Required for demuxing stdout/stderr
        Env: Object.entries(environment).map(([k, v]) => `${k}=${v}`),
        WorkingDir: "/workspace",
        HostConfig: {
          AutoRemove: false, // Must persist for reuse
        },
      });

      await container.start();
      const containerId = container.id;

      logger.info(
        { taskId, containerId: containerId.slice(0, 12) },
        "Dev container started",
      );

      // Track in database
      await store.create(taskId, containerId);

      return containerId;
    },

    async execute(
      taskId: string,
      options: DevContainerExecOptions,
    ): Promise<DevContainerExecResult> {
      const {
        command,
        workdir = "/workspace",
        timeoutMs = DEV_CONTAINER_TIMEOUTS.default,
      } = options;

      const containerName = getContainerName(taskId);
      const commandStr = command.join(" ");
      const startTime = performance.now();

      logger.debug(
        { taskId, command: commandStr, workdir, timeoutMs },
        "Executing in dev container",
      );

      // Find container
      const container = await findContainerByName(containerName);
      if (!container) {
        throw new Error(`Container not found for task ${taskId}`);
      }

      // Update activity timestamp
      await store.updateActivity(taskId);

      // Create exec
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false, // Required for demuxing
        WorkingDir: workdir,
      });

      const stream = await exec.start({ Detach: false });

      // Race between execution and timeout
      const execPromise = (async () => {
        const { stdout, stderr } = await demuxStream(stream, docker);
        const inspect = await exec.inspect();

        return {
          exitCode: inspect.ExitCode ?? 1,
          stdout,
          stderr,
          timedOut: false,
        };
      })();

      const timeoutPromise = new Promise<DevContainerExecResult>((resolve) => {
        setTimeout(() => {
          resolve({
            exitCode: 124, // Standard timeout exit code
            stdout: "",
            stderr: `Command timed out after ${timeoutMs}ms`,
            timedOut: true,
          });
        }, timeoutMs);
      });

      const result = await Promise.race([execPromise, timeoutPromise]);

      const durationMs = Math.round(performance.now() - startTime);

      if (result.timedOut) {
        logger.warn(
          { taskId, command: commandStr, timeoutMs, durationMs },
          "Command timed out",
        );
      } else {
        logger.debug(
          {
            taskId,
            command: commandStr,
            exitCode: result.exitCode,
            durationMs,
          },
          "Command completed",
        );
      }

      return result;
    },

    async findByTaskId(taskId: string): Promise<string | null> {
      const record = await store.getByTaskId(taskId);
      if (!record) return null;

      // Verify container actually exists
      const containerName = getContainerName(taskId);
      const container = await findContainerByName(containerName);
      if (!container) {
        // Container doesn't exist but record does - clean up
        await store.delete(taskId);
        return null;
      }

      try {
        const inspect = await container.inspect();
        if (!inspect.State.Running) {
          await store.updateStatus(taskId, "stopped");
          return null;
        }
        return record.container_id;
      } catch {
        await store.updateStatus(taskId, "failed");
        return null;
      }
    },

    async isRunning(taskId: string): Promise<boolean> {
      const containerId = await this.findByTaskId(taskId);
      return containerId !== null;
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      return store.health();
    },

    async close(): Promise<void> {
      await store.close();
    },
  };
}
