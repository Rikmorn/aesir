/**
 * Forward Sync Listener
 *
 * Fires asynchronous status sync to external artifacts when internal task
 * status changes. Only syncs terminal-ish transitions (active, completed,
 * cancelled) for tasks that have materialization records.
 *
 * Composes alongside TaskSignalDispatcher -- not mixed into it.
 * Non-fatal: sync failures are logged, never block internal state changes.
 */

import type { PinoLogger } from "@aesir/platform";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../db/schema.js";
import { materializationRecords } from "../../db/schema.js";
import type { MaterializationAdapter } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ForwardSyncListenerOptions {
  adapter: MaterializationAdapter;
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

export interface ForwardSyncListener {
  /** Called after a task status changes. Fires async sync if materialized. */
  onTaskUpdate(
    taskId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<void>;
}

// ─── Syncable Statuses ────────────────────────────────────────────────────────

/**
 * Only sync these statuses to external artifacts.
 * Intermediate states (created, counter_proposed, paused) are internal process.
 */
const SYNCABLE_STATUSES = new Set(["active", "completed", "cancelled"]);

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createForwardSyncListener(
  options: ForwardSyncListenerOptions,
): ForwardSyncListener {
  const { adapter, db, logger: parentLogger } = options;

  if (!adapter) throw new Error("adapter is required for ForwardSyncListener");
  if (!db) throw new Error("db is required for ForwardSyncListener");
  if (!parentLogger)
    throw new Error("logger is required for ForwardSyncListener");

  const logger = parentLogger.child({ component: "forward-sync-listener" });

  return {
    async onTaskUpdate(taskId, _oldStatus, newStatus) {
      // Only sync terminal-ish transitions
      if (!SYNCABLE_STATUSES.has(newStatus)) {
        return;
      }

      try {
        // Check if task has a materialization record
        const records = await db
          .select()
          .from(materializationRecords)
          .where(eq(materializationRecords.task_id, taskId));

        const record = records[0];
        if (!record) {
          return; // Not materialized
        }

        // Fire async sync to external artifact
        await adapter.syncStatus({
          externalId: record.external_id,
          taskId,
          newStatus: newStatus as "active" | "completed" | "cancelled",
        });

        logger.debug(
          { taskId, externalId: record.external_id, newStatus },
          "Forward sync completed for materialized task",
        );
      } catch (err) {
        // Non-fatal: sync failures logged, never block internal state changes
        logger.error(
          { err, taskId, newStatus },
          "Forward sync failed for materialized task (non-fatal)",
        );
      }
    },
  };
}
