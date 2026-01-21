/**
 * Cleanup Service
 *
 * Deletes old data based on retention period:
 * - Webhook deliveries older than retention
 * - Agent executions older than retention (except in-progress)
 * - LangGraph checkpoints for completed threads
 *
 * Uses batch deletion to avoid long-running transactions.
 */

import type { PinoLogger } from "@aesir/common";
import { fromPromise, type ResultAsync } from "neverthrow";
import type { Pool } from "pg";
import { CleanupError } from "../errors/index.js";

export interface CleanupServiceOptions {
  pool: Pool; // Raw pg Pool for cross-schema queries
  logger: PinoLogger;
  retentionDays: number;
  batchSize: number;
}

export interface CleanupReport {
  webhookDeliveries: { deleted: number; scanned: number };
  agentExecutions: {
    deleted: number;
    scanned: number;
    skippedInProgress: number;
  };
  checkpoints: {
    deletedThreads: number;
    deletedCheckpoints: number;
    deletedBlobs: number;
    deletedWrites: number;
  };
  dryRun: boolean;
  durationMs: number;
}

export interface CleanupService {
  /**
   * Run cleanup for all tables
   * @param options.dryRun - If true, only count what would be deleted
   * @returns ResultAsync with CleanupReport on success, CleanupError on failure
   */
  run(options: { dryRun: boolean }): ResultAsync<CleanupReport, CleanupError>;

  /**
   * Health check
   */
  health(): Promise<{ healthy: boolean }>;

  /**
   * Cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Create cleanup service
 */
export function createCleanupService(
  options: CleanupServiceOptions,
): CleanupService {
  const { pool, logger, retentionDays, batchSize } = options;

  if (!pool) throw new Error("pool is required for CleanupService");
  if (!logger) throw new Error("logger is required for CleanupService");
  if (retentionDays <= 0) throw new Error("retentionDays must be positive");
  if (batchSize <= 0) throw new Error("batchSize must be positive");

  const getCutoffDate = () =>
    new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  return {
    run({ dryRun }): ResultAsync<CleanupReport, CleanupError> {
      return fromPromise(
        runCleanup(
          pool,
          logger,
          retentionDays,
          batchSize,
          getCutoffDate,
          dryRun,
        ),
        (error) => {
          logger.error(
            { err: error, dryRun, retentionDays },
            "Cleanup operation failed",
          );
          return new CleanupError(
            "PLT_CLEANUP_CHECKPOINTS",
            "Failed to run cleanup operation",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { dryRun, retentionDays },
            },
          );
        },
      );
    },

    async health(): Promise<{ healthy: boolean }> {
      try {
        await pool.query("SELECT 1");
        return { healthy: true };
      } catch {
        return { healthy: false };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - pool managed externally
    },
  };
}

/**
 * Internal implementation of cleanup logic
 */
async function runCleanup(
  pool: Pool,
  logger: PinoLogger,
  retentionDays: number,
  batchSize: number,
  getCutoffDate: () => Date,
  dryRun: boolean,
): Promise<CleanupReport> {
  const start = Date.now();
  const cutoffDate = getCutoffDate();

  logger.info(
    {
      dryRun,
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      batchSize,
    },
    "Starting cleanup run",
  );

  const report: CleanupReport = {
    webhookDeliveries: { deleted: 0, scanned: 0 },
    agentExecutions: { deleted: 0, scanned: 0, skippedInProgress: 0 },
    checkpoints: {
      deletedThreads: 0,
      deletedCheckpoints: 0,
      deletedBlobs: 0,
      deletedWrites: 0,
    },
    dryRun,
    durationMs: 0,
  };

  // Clean webhook deliveries
  await cleanupWebhookDeliveries(
    pool,
    cutoffDate,
    batchSize,
    dryRun,
    report,
    logger,
  );

  // Clean agent executions (protect in-progress)
  await cleanupAgentExecutions(
    pool,
    cutoffDate,
    batchSize,
    dryRun,
    report,
    logger,
  );

  // Clean LangGraph checkpoints
  await cleanupCheckpoints(pool, cutoffDate, batchSize, dryRun, report, logger);

  report.durationMs = Date.now() - start;

  logger.info({ report }, "Cleanup run completed");

  return report;
}

async function cleanupWebhookDeliveries(
  pool: Pool,
  cutoffDate: Date,
  batchSize: number,
  dryRun: boolean,
  report: CleanupReport,
  logger: PinoLogger,
): Promise<void> {
  // Use raw SQL for cross-schema access
  const countResult = await pool.query(
    "SELECT COUNT(*) as count FROM integrations.webhook_deliveries WHERE created_at < $1",
    [cutoffDate],
  );
  report.webhookDeliveries.scanned = Number.parseInt(
    countResult.rows[0]?.count ?? "0",
    10,
  );

  if (dryRun) {
    report.webhookDeliveries.deleted = report.webhookDeliveries.scanned;
    logger.info(
      { count: report.webhookDeliveries.scanned },
      "[DRY RUN] Would delete webhook deliveries",
    );
    return;
  }

  // Batch delete
  let totalDeleted = 0;
  while (true) {
    const result = await pool.query(
      `DELETE FROM integrations.webhook_deliveries
       WHERE id IN (
         SELECT id FROM integrations.webhook_deliveries
         WHERE created_at < $1
         LIMIT $2
       )
       RETURNING id`,
      [cutoffDate, batchSize],
    );

    const deleted = result.rowCount ?? 0;
    totalDeleted += deleted;

    // Log each deleted ID for audit trail
    for (const row of result.rows) {
      logger.debug(
        { id: row.id, table: "webhook_deliveries" },
        "Record deleted",
      );
    }

    if (deleted < batchSize) break;
  }

  report.webhookDeliveries.deleted = totalDeleted;
  logger.info({ deleted: totalDeleted }, "Webhook deliveries cleaned up");
}

async function cleanupAgentExecutions(
  pool: Pool,
  cutoffDate: Date,
  batchSize: number,
  dryRun: boolean,
  report: CleanupReport,
  logger: PinoLogger,
): Promise<void> {
  // Count total eligible (completed/failed, older than cutoff)
  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM observability.agent_executions
     WHERE ended_at < $1 AND status IN ('completed', 'failed')`,
    [cutoffDate],
  );
  report.agentExecutions.scanned = Number.parseInt(
    countResult.rows[0]?.count ?? "0",
    10,
  );

  // Count in-progress that would be skipped
  const inProgressResult = await pool.query(
    `SELECT COUNT(*) as count FROM observability.agent_executions
     WHERE started_at < $1 AND status = 'started'`,
    [cutoffDate],
  );
  report.agentExecutions.skippedInProgress = Number.parseInt(
    inProgressResult.rows[0]?.count ?? "0",
    10,
  );

  if (dryRun) {
    report.agentExecutions.deleted = report.agentExecutions.scanned;
    logger.info(
      {
        count: report.agentExecutions.scanned,
        skipped: report.agentExecutions.skippedInProgress,
      },
      "[DRY RUN] Would delete agent executions (protecting in-progress)",
    );
    return;
  }

  // Batch delete (only completed/failed)
  let totalDeleted = 0;
  while (true) {
    const result = await pool.query(
      `DELETE FROM observability.agent_executions
       WHERE id IN (
         SELECT id FROM observability.agent_executions
         WHERE ended_at < $1 AND status IN ('completed', 'failed')
         LIMIT $2
       )
       RETURNING id`,
      [cutoffDate, batchSize],
    );

    const deleted = result.rowCount ?? 0;
    totalDeleted += deleted;

    for (const row of result.rows) {
      logger.debug({ id: row.id, table: "agent_executions" }, "Record deleted");
    }

    if (deleted < batchSize) break;
  }

  report.agentExecutions.deleted = totalDeleted;
  logger.info(
    {
      deleted: totalDeleted,
      skipped: report.agentExecutions.skippedInProgress,
    },
    "Agent executions cleaned up (in-progress protected)",
  );
}

async function cleanupCheckpoints(
  pool: Pool,
  cutoffDate: Date,
  batchSize: number,
  dryRun: boolean,
  report: CleanupReport,
  logger: PinoLogger,
): Promise<void> {
  // LangGraph checkpoints don't have timestamps, so we use agent_executions as proxy
  // Find thread_ids from completed executions older than retention
  // Thread ID format: approval-{issue_id} (from existing codebase pattern)

  const threadsResult = await pool.query(
    `SELECT DISTINCT CONCAT('approval-', issue_id) as thread_id
     FROM observability.agent_executions
     WHERE status IN ('completed', 'failed')
     AND ended_at < $1
     AND CONCAT('approval-', issue_id) NOT IN (
       SELECT CONCAT('approval-', issue_id)
       FROM observability.agent_executions
       WHERE status = 'started'
     )
     LIMIT $2`,
    [cutoffDate, batchSize],
  );

  const threadIds = threadsResult.rows.map(
    (r: { thread_id: string }) => r.thread_id,
  );
  report.checkpoints.deletedThreads = threadIds.length;

  if (dryRun) {
    logger.info(
      { threadCount: threadIds.length },
      "[DRY RUN] Would delete checkpoints for threads",
    );
    return;
  }

  // Delete checkpoint data for each thread
  // Order: writes -> blobs -> checkpoints (logical dependency order)
  for (const threadId of threadIds) {
    // checkpoint_writes
    const writesResult = await pool.query(
      "DELETE FROM checkpoint_writes WHERE thread_id = $1",
      [threadId],
    );
    report.checkpoints.deletedWrites += writesResult.rowCount ?? 0;

    // checkpoint_blobs
    const blobsResult = await pool.query(
      "DELETE FROM checkpoint_blobs WHERE thread_id = $1",
      [threadId],
    );
    report.checkpoints.deletedBlobs += blobsResult.rowCount ?? 0;

    // checkpoints
    const checkpointsResult = await pool.query(
      "DELETE FROM checkpoints WHERE thread_id = $1",
      [threadId],
    );
    report.checkpoints.deletedCheckpoints += checkpointsResult.rowCount ?? 0;

    logger.debug({ threadId }, "Checkpoint data deleted for thread");
  }

  logger.info(
    {
      threads: report.checkpoints.deletedThreads,
      checkpoints: report.checkpoints.deletedCheckpoints,
      blobs: report.checkpoints.deletedBlobs,
      writes: report.checkpoints.deletedWrites,
    },
    "LangGraph checkpoints cleaned up",
  );
}
