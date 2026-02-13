/**
 * Timeout Scheduler
 *
 * Wraps pg-boss for durable delayed signal delivery to paused conversations.
 * When an agent calls wait_for with a timeout (e.g., "72h"), the executor
 * schedules a delayed job that fires after the specified duration, delivering
 * a wait_timeout signal via executor.signal().
 *
 * Uses the existing pg.Pool via an IDatabase adapter (no second connection pool).
 * pg-boss manages its own schema ("pgboss" by default) with auto-migration.
 */

import type { PinoLogger } from "@aesir/platform";
import type { Pool } from "pg";
import type { Job } from "pg-boss";
import { PgBoss } from "pg-boss";
import type { ConversationExecutor, Signal } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** pg-boss queue name for conversation timeout jobs */
export const TIMEOUT_QUEUE = "conversation-timeout";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Data stored in each timeout job */
export interface TimeoutJobData {
  conversationId: string;
  waitType: string;
  reason: string;
  /** Metadata from the pending wait (e.g., taskId for wait_for_task) */
  metadata?: Record<string, unknown>;
}

/** Options for creating a TimeoutScheduler */
export interface TimeoutSchedulerOptions {
  /** Existing pg connection pool (shared with pg-boss via IDatabase adapter) */
  pool: Pool;
  /** Logger instance */
  logger: PinoLogger;
  /** pg-boss schema name (default: "pgboss") */
  schema?: string;
}

/** TimeoutScheduler manages delayed signal delivery for paused conversations */
export interface TimeoutScheduler {
  /**
   * Initialize pg-boss and register the timeout worker.
   * Must be called before schedule/cancel.
   * The worker delivers wait_timeout signals via executor.signal().
   */
  start(executor: ConversationExecutor): Promise<void>;

  /**
   * Schedule a timeout signal for a conversation.
   * Returns the pg-boss job ID for later cancellation.
   */
  schedule(
    conversationId: string,
    timeoutDuration: string,
    waitType: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<string>;

  /**
   * Cancel a pending timeout by job ID.
   * No-op if the job already fired or was already cancelled.
   */
  cancel(jobId: string): Promise<void>;

  /**
   * Graceful shutdown: stop pg-boss.
   */
  close(): Promise<void>;
}

// ─── IDatabase Adapter ───────────────────────────────────────────────────────

/**
 * Adapt pg.Pool to pg-boss's IDatabase interface.
 * pg-boss only needs executeSql(text, values) => { rows }.
 * This allows pg-boss to share the existing connection pool.
 */
export function createPgBossAdapter(pool: Pool) {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      // pg returns an array of QueryResult for multi-statement SQL.
      // pg-boss's unwrapSQLResult expects the raw array so it can flatMap .rows.
      // The IDatabase type is too narrow (only declares { rows }) but the runtime
      // handles arrays correctly -- cast to satisfy the interface.
      if (Array.isArray(result)) {
        return result.map((r) => ({
          rows: r.rows,
          rowCount: r.rowCount ?? 0,
        })) as unknown as { rows: unknown[] };
      }
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}

// ─── Duration Parser ─────────────────────────────────────────────────────────

/**
 * Parse a timeout duration string into milliseconds.
 * Supported formats:
 * - "<number>s" (seconds) -- useful for short timeouts like delegation handshakes
 * - "<number>m" (minutes) -- useful for testing
 * - "<number>h" (hours)
 * - "<number>d" (days)
 *
 * @throws Error on invalid format
 */
export function parseTimeoutDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Invalid timeout duration: "${duration}". Expected format: <number>s, <number>m, <number>h, or <number>d`,
    );
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

/**
 * Convert a duration string to a future Date for pg-boss startAfter.
 */
function computeStartAfter(duration: string): Date {
  const ms = parseTimeoutDuration(duration);
  return new Date(Date.now() + ms);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a TimeoutScheduler that wraps pg-boss for delayed signal delivery.
 *
 * @param options - Pool, logger, and optional schema name
 * @returns TimeoutScheduler with start/schedule/cancel/close methods
 */
export function createTimeoutScheduler(
  options: TimeoutSchedulerOptions,
): TimeoutScheduler {
  const { pool, logger: parentLogger, schema = "pgboss" } = options;
  const logger = parentLogger.child({ component: "timeout-scheduler" });

  const dbAdapter = createPgBossAdapter(pool);

  const boss = new PgBoss({
    db: dbAdapter,
    schema,
    // Cron scheduling not needed (we use send() with startAfter, not cron)
    schedule: false,
    // Auto-create and migrate pg-boss schema on start()
    migrate: true,
  });

  // Handle pg-boss error events to prevent ERR_UNHANDLED_ERROR crashes.
  // Worker-level errors (queue not found, fetch failures) are emitted here.
  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
  });

  return {
    async start(executor: ConversationExecutor): Promise<void> {
      await boss.start();

      // Ensure the queue exists (pg-boss v10+ requires explicit queue creation)
      await boss.createQueue(TIMEOUT_QUEUE);

      // Register timeout worker that delivers wait_timeout signals
      await boss.work<TimeoutJobData>(
        TIMEOUT_QUEUE,
        async (jobs: Job<TimeoutJobData>[]) => {
          const job = jobs[0];
          if (!job) return;

          const { conversationId, waitType, reason, metadata } = job.data;

          const signal: Signal = {
            // Use the original wait type so the signal matches the pending_wait.
            // The timeout context is communicated via source and data fields.
            // Metadata (e.g., taskId) is merged so taskId-scoped matching works.
            type: waitType,
            data: { timeout: true, reason, ...metadata },
            message: `Wait timeout: you have been paused waiting for '${waitType}'. No signal was received. Decide whether to escalate, retry, or complete.`,
            source: "internal:scheduler",
            deduplicationId: `timeout-${conversationId}-${job.id}`,
          };

          const result = await executor.signal(conversationId, signal);

          if (result.action === "rejected") {
            logger.info(
              { conversationId, jobId: job.id },
              "Timeout signal rejected (conversation no longer waiting)",
            );
          } else {
            logger.info(
              { conversationId, action: result.action, jobId: job.id },
              "Timeout signal delivered",
            );
          }
        },
      );

      logger.info("Timeout scheduler started");
    },

    async schedule(
      conversationId: string,
      timeoutDuration: string,
      waitType: string,
      reason: string,
      metadata?: Record<string, unknown>,
    ): Promise<string> {
      const startAfter = computeStartAfter(timeoutDuration);

      const jobId = await boss.send(
        TIMEOUT_QUEUE,
        { conversationId, waitType, reason, metadata },
        {
          startAfter,
          singletonKey: conversationId,
        },
      );

      if (!jobId) {
        throw new Error(
          `Failed to schedule timeout for conversation ${conversationId}`,
        );
      }

      logger.info(
        {
          conversationId,
          timeoutDuration,
          jobId,
          startAfter: startAfter.toISOString(),
        },
        "Timeout scheduled",
      );

      return jobId;
    },

    async cancel(jobId: string): Promise<void> {
      try {
        await boss.cancel(TIMEOUT_QUEUE, jobId);
        logger.debug({ jobId }, "Timeout cancelled");
      } catch (error) {
        // Job may have already fired, been cancelled, or expired -- that's OK
        logger.debug(
          { jobId, err: error },
          "Timeout cancel failed (may have already fired)",
        );
      }
    },

    async close(): Promise<void> {
      await boss.stop();
      logger.info("Timeout scheduler stopped");
    },
  };
}
