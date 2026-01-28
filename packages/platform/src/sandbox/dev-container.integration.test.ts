/**
 * Dev Container Integration Test
 *
 * E2E verification of dev container lifecycle (CONT-11):
 * - Spawn container with unique name
 * - Execute command and capture output
 * - Verify output contents
 * - Cleanup container
 *
 * Requires Docker to be running. Skipped if Docker is unavailable.
 * Run with: pnpm test:integration
 */

import { existsSync } from "node:fs";
import { createLogger } from "@aesir/platform";
import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DevContainerManager } from "./dev-container.js";
import { createDevContainerManager } from "./dev-container.js";
import type { DevContainerCleanup } from "./dev-container-cleanup.js";
import { createDevContainerCleanup } from "./dev-container-cleanup.js";

// Check Docker socket availability synchronously at module load time
// This allows it.skipIf to evaluate correctly before tests run
// Check multiple common socket locations (Docker Desktop uses ~/.docker/run/docker.sock)
const possibleSocketPaths = [
  process.env.DOCKER_HOST?.replace("unix://", ""),
  `${process.env.HOME}/.docker/run/docker.sock`, // Docker Desktop on macOS
  "/var/run/docker.sock", // Standard Linux location
].filter(Boolean) as string[];

const socketPath = possibleSocketPaths.find((p) => existsSync(p));
const dockerSocketExists = socketPath !== undefined;

// Docker client instance
const docker = new Docker();

// Will be set true only if Docker daemon is actually responsive
let dockerAvailable = dockerSocketExists;

describe("DevContainer E2E", () => {
  /**
   * Mock database for integration test.
   *
   * The store operations are mocked to avoid requiring a real PostgreSQL instance.
   * This allows testing the Docker container lifecycle independently.
   * In a full integration test suite, testcontainers PostgreSQL would be used.
   */
  const taskRecords = new Map<
    string,
    { container_id: string; task_id: string; status: string }
  >();

  const logger = createLogger({ component: "test:dev-container" });
  let manager: DevContainerManager;
  let cleanup: DevContainerCleanup;

  // Unique test task ID to avoid conflicts with other tests
  const testTaskId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Create mock database that tracks container records by task ID.
   * This mock implements the minimal interface needed by the store.
   */
  function createMockDb() {
    return {
      insert: () => ({
        values: async (record: { task_id: string; container_id: string }) => {
          taskRecords.set(record.task_id, {
            container_id: record.container_id,
            task_id: record.task_id,
            status: "running",
          });
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              // Return record for testTaskId if it exists
              const record = taskRecords.get(testTaskId);
              return record ? [record] : [];
            },
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {},
        }),
      }),
      delete: () => ({
        where: async () => {
          taskRecords.delete(testTaskId);
          return { rowCount: 1 };
        },
      }),
      execute: async () => {},
    } as unknown;
  }

  beforeAll(async () => {
    if (!dockerSocketExists) {
      console.log("Docker socket not found, skipping integration tests");
      dockerAvailable = false;
      return;
    }

    // Verify Docker daemon is responsive
    try {
      await docker.ping();
      dockerAvailable = true;
    } catch {
      console.log("Docker daemon not responding, skipping integration tests");
      dockerAvailable = false;
      return;
    }

    const mockDb = createMockDb();

    manager = createDevContainerManager({
      db: mockDb as Parameters<typeof createDevContainerManager>[0]["db"],
      logger,
      docker,
    });

    cleanup = createDevContainerCleanup({
      db: mockDb as Parameters<typeof createDevContainerCleanup>[0]["db"],
      logger,
      docker,
    });
  });

  afterAll(async () => {
    if (!dockerAvailable) return;

    // Cleanup test container (force remove if still exists)
    try {
      const container = docker.getContainer(`dev-container-${testTaskId}`);
      await container.stop({ t: 1 }).catch(() => {});
      await container.remove().catch(() => {});
    } catch {
      // Container might already be cleaned up
    }

    await manager?.close();
    await cleanup?.close();
  });

  it.skipIf(!dockerSocketExists)(
    "should spawn container with unique name",
    async () => {
      if (!dockerAvailable) return;

      const containerId = await manager.spawn({
        taskId: testTaskId,
        image: "node:20-slim", // Use standard image - aesir-dev-env may not be built
      });

      expect(containerId).toBeDefined();
      expect(containerId.length).toBe(64); // Full Docker ID is 64 chars

      // Verify container exists and is running
      const container = docker.getContainer(`dev-container-${testTaskId}`);
      const inspect = await container.inspect();

      expect(inspect.State.Running).toBe(true);
      expect(inspect.Name).toBe(`/dev-container-${testTaskId}`);
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should execute command and capture output",
    async () => {
      if (!dockerAvailable) return;

      const result = await manager.execute(testTaskId, {
        command: ["echo", "hello from dev container"],
        timeoutMs: 10_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello from dev container");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBeFalsy();
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should capture stderr separately",
    async () => {
      if (!dockerAvailable) return;

      const result = await manager.execute(testTaskId, {
        command: ["sh", "-c", "echo stdout && >&2 echo stderr"],
        timeoutMs: 10_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("stdout");
      expect(result.stderr).toContain("stderr");
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should return non-zero exit code for failing commands",
    async () => {
      if (!dockerAvailable) return;

      const result = await manager.execute(testTaskId, {
        command: ["false"], // Always exits with 1
        timeoutMs: 10_000,
      });

      expect(result.exitCode).toBe(1);
    },
  );

  it.skipIf(!dockerSocketExists)("should handle command timeout", async () => {
    if (!dockerAvailable) return;

    const result = await manager.execute(testTaskId, {
      command: ["sleep", "10"],
      timeoutMs: 500, // Very short timeout
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124); // Timeout exit code
  });

  it.skipIf(!dockerSocketExists)(
    "should reuse existing running container",
    async () => {
      if (!dockerAvailable) return;

      // Spawn again with same taskId - should reuse
      const containerId = await manager.spawn({
        taskId: testTaskId,
        image: "node:20-slim",
      });

      expect(containerId).toBeDefined();

      // Should still only have one container with this name
      const containers = await docker.listContainers({
        all: true,
        filters: { name: [`dev-container-${testTaskId}`] },
      });

      expect(containers.length).toBe(1);
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should find container by task ID",
    async () => {
      if (!dockerAvailable) return;

      const foundId = await manager.findByTaskId(testTaskId);
      expect(foundId).toBeDefined();
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should report container as running",
    async () => {
      if (!dockerAvailable) return;

      const isRunning = await manager.isRunning(testTaskId);
      expect(isRunning).toBe(true);
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should cleanup container successfully",
    async () => {
      if (!dockerAvailable) return;

      const result = await cleanup.cleanupContainer(testTaskId);

      expect(result.success).toBe(true);
      expect(result.taskId).toBe(testTaskId);

      // Verify container no longer exists
      try {
        const container = docker.getContainer(`dev-container-${testTaskId}`);
        await container.inspect();
        expect.fail("Container should have been removed");
      } catch (err: unknown) {
        // Expected - container should not exist
        expect((err as { statusCode?: number }).statusCode).toBe(404);
      }
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should return null for non-existent container",
    async () => {
      if (!dockerAvailable) return;

      const foundId = await manager.findByTaskId("non-existent-task");
      expect(foundId).toBeNull();
    },
  );

  it.skipIf(!dockerSocketExists)(
    "should report non-existent container as not running",
    async () => {
      if (!dockerAvailable) return;

      const isRunning = await manager.isRunning("non-existent-task");
      expect(isRunning).toBe(false);
    },
  );
});
