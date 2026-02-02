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
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}

// ─── Duration Parser ─────────────────────────────────────────────────────────

/**
 * Parse a timeout duration string into milliseconds.
 * Supported formats:
 * - "<number>m" (minutes) -- useful for testing
 * - "<number>h" (hours)
 * - "<number>d" (days)
 *
 * @throws Error on invalid format
 */
export function parseTimeoutDuration(duration: string): number {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Invalid timeout duration: "${duration}". Expected format: <number>m, <number>h, or <number>d`,
    );
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
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

  return {
    async start(executor: ConversationExecutor): Promise<void> {
      await boss.start();

      // Register timeout worker that delivers wait_timeout signals
      await boss.work<TimeoutJobData>(
        TIMEOUT_QUEUE,
        async (jobs: Job<TimeoutJobData>[]) => {
          const job = jobs[0];
          if (!job) return;

          const { conversationId, waitType, reason } = job.data;

          const signal: Signal = {
            type: "wait_timeout",
            data: { originalWaitType: waitType, reason },
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
    ): Promise<string> {
      const startAfter = computeStartAfter(timeoutDuration);

      const jobId = await boss.send(
        TIMEOUT_QUEUE,
        { conversationId, waitType, reason },
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
