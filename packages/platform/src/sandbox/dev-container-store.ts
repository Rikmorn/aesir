/**
 * Dev Container Store
 *
 * Database-backed storage for dev container state.
 * Provides CRUD operations for container tracking.
 */

import type { PinoLogger } from "@aesir/common";
import { createId } from "@aesir/common";
import { and, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  type DevContainer,
  devContainers,
} from "../db/schema/dev-containers.js";

/** Options for creating the store */
export interface DevContainerStoreOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
}

/** Dev container store interface */
export interface DevContainerStore {
  /** Create a new container record */
  create(taskId: string, containerId: string): Promise<string>;

  /** Get container by task ID */
  getByTaskId(taskId: string): Promise<DevContainer | null>;

  /** Update container status */
  updateStatus(
    taskId: string,
    status: "running" | "stopped" | "failed",
  ): Promise<void>;

  /** Update last activity timestamp */
  updateActivity(taskId: string): Promise<void>;

  /** Delete container record */
  delete(taskId: string): Promise<boolean>;

  /** Find containers inactive for specified duration */
  findInactive(olderThanMs: number): Promise<DevContainer[]>;

  /** Health check */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /** Cleanup resources */
  close(): Promise<void>;
}

/**
 * Create dev container store
 *
 * Factory function for database-backed container tracking.
 */
export function createDevContainerStore(
  options: DevContainerStoreOptions,
): DevContainerStore {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for DevContainerStore");
  if (!logger) throw new Error("logger is required for DevContainerStore");

  return {
    async create(taskId: string, containerId: string): Promise<string> {
      const id = createId.devContainer();

      logger.info({ taskId, containerId }, "Creating dev container record");

      await db.insert(devContainers).values({
        id,
        task_id: taskId,
        container_id: containerId,
        status: "running",
      });

      return id;
    },

    async getByTaskId(taskId: string): Promise<DevContainer | null> {
      const rows = await db
        .select()
        .from(devContainers)
        .where(eq(devContainers.task_id, taskId))
        .limit(1);

      return rows[0] ?? null;
    },

    async updateStatus(
      taskId: string,
      status: "running" | "stopped" | "failed",
    ): Promise<void> {
      logger.debug({ taskId, status }, "Updating container status");

      await db
        .update(devContainers)
        .set({ status })
        .where(eq(devContainers.task_id, taskId));
    },

    async updateActivity(taskId: string): Promise<void> {
      await db
        .update(devContainers)
        .set({ last_activity: new Date() })
        .where(eq(devContainers.task_id, taskId));
    },

    async delete(taskId: string): Promise<boolean> {
      logger.info({ taskId }, "Deleting dev container record");

      const result = await db
        .delete(devContainers)
        .where(eq(devContainers.task_id, taskId));

      // Check if any rows were deleted
      return (result as { rowCount?: number }).rowCount !== 0;
    },

    async findInactive(olderThanMs: number): Promise<DevContainer[]> {
      const cutoff = new Date(Date.now() - olderThanMs);

      return await db
        .select()
        .from(devContainers)
        .where(
          and(
            eq(devContainers.status, "running"),
            lt(devContainers.last_activity, cutoff),
          ),
        );
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - db is managed externally
    },
  };
}
