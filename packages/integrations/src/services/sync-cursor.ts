/**
 * Sync Cursor Service
 *
 * Tracks synchronization progress for incremental syncs.
 * Stores cursor values per workspace+provider+resource combination.
 */

import type { PinoLogger } from "@aesir/common";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { syncCursors } from "../db/schema.js";

export interface SyncCursorServiceOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

export interface SyncCursorKey {
  workspaceId: string;
  provider: string;
  resourceType: string;
}

export interface SyncCursorValue {
  cursor: string | null;
  lastSyncAt: Date | null;
}

export interface SyncCursorService {
  /**
   * Get cursor for workspace+provider+resource
   *
   * @returns cursor value and last sync time, or null if no cursor exists
   */
  get(key: SyncCursorKey): Promise<SyncCursorValue | null>;

  /**
   * Set cursor for workspace+provider+resource (upsert)
   *
   * @param key - Cursor key (workspace, provider, resource)
   * @param value - Cursor value and sync timestamp
   */
  set(key: SyncCursorKey, value: SyncCursorValue): Promise<void>;

  /**
   * Clear cursor for re-sync scenarios
   *
   * @param key - Cursor key to delete
   * @returns true if cursor was deleted, false if it didn't exist
   */
  clear(key: SyncCursorKey): Promise<boolean>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources (no-op for this service, but interface consistency)
   */
  close(): Promise<void>;
}

/**
 * Create sync cursor service
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE for atomic upsert.
 */
export function createSyncCursorService(
  options: SyncCursorServiceOptions,
): SyncCursorService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for SyncCursorService");
  if (!logger) throw new Error("logger is required for SyncCursorService");

  return {
    async get(key: SyncCursorKey): Promise<SyncCursorValue | null> {
      const result = await db
        .select({
          cursor: syncCursors.cursor,
          lastSyncAt: syncCursors.last_sync_at,
        })
        .from(syncCursors)
        .where(
          and(
            eq(syncCursors.workspace_id, key.workspaceId),
            eq(syncCursors.provider, key.provider),
            eq(syncCursors.resource_type, key.resourceType),
          ),
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        logger.debug(
          {
            workspaceId: key.workspaceId,
            provider: key.provider,
            resourceType: key.resourceType,
          },
          "Sync cursor not found",
        );
        return null;
      }

      return {
        cursor: row.cursor,
        lastSyncAt: row.lastSyncAt,
      };
    },

    async set(key: SyncCursorKey, value: SyncCursorValue): Promise<void> {
      await db
        .insert(syncCursors)
        .values({
          workspace_id: key.workspaceId,
          provider: key.provider,
          resource_type: key.resourceType,
          cursor: value.cursor,
          last_sync_at: value.lastSyncAt,
        })
        .onConflictDoUpdate({
          target: [
            syncCursors.workspace_id,
            syncCursors.provider,
            syncCursors.resource_type,
          ],
          set: {
            cursor: value.cursor,
            last_sync_at: value.lastSyncAt,
            updated_at: new Date(),
          },
        });

      logger.info(
        {
          workspaceId: key.workspaceId,
          provider: key.provider,
          resourceType: key.resourceType,
          cursor: value.cursor,
        },
        "Sync cursor updated",
      );
    },

    async clear(key: SyncCursorKey): Promise<boolean> {
      const result = await db
        .delete(syncCursors)
        .where(
          and(
            eq(syncCursors.workspace_id, key.workspaceId),
            eq(syncCursors.provider, key.provider),
            eq(syncCursors.resource_type, key.resourceType),
          ),
        )
        .returning({ id: syncCursors.id });

      const deleted = result.length > 0;

      if (deleted) {
        logger.info(
          {
            workspaceId: key.workspaceId,
            provider: key.provider,
            resourceType: key.resourceType,
          },
          "Sync cursor cleared",
        );
      } else {
        logger.debug(
          {
            workspaceId: key.workspaceId,
            provider: key.provider,
            resourceType: key.resourceType,
          },
          "Sync cursor not found for clearing",
        );
      }

      return deleted;
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        // Simple connectivity check
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - db connection is managed externally
    },
  };
}
