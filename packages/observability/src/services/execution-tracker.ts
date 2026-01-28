/**
 * Execution Tracker Service
 *
 * Records agent execution lifecycle: start, complete, fail.
 * Calculates duration_ms on completion/failure.
 */

import { createId } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fromPromise, type ResultAsync } from "neverthrow";
import { agentExecutions } from "../db/schema.js";
import { ExecutionTrackerError } from "../errors/index.js";

export type AgentType = "dev-agent" | "product-agent";
export type ExecutionStatus = "started" | "completed" | "failed";

export interface ExecutionTrackerOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

export interface StartExecutionParams {
  agentType: AgentType;
  issueId: string;
  workspaceId: string;
}

export interface ExecutionTracker {
  /**
   * Start tracking a new execution
   *
   * @returns ResultAsync with execution ID (exec_xxx format) on success
   */
  start(
    params: StartExecutionParams,
  ): ResultAsync<string, ExecutionTrackerError>;

  /**
   * Mark execution as completed successfully
   * Calculates duration_ms from started_at
   *
   * @returns ResultAsync with void on success (returns ok even if execution not found - defensive behavior)
   */
  complete(executionId: string): ResultAsync<void, ExecutionTrackerError>;

  /**
   * Mark execution as failed
   * Captures last known state for debugging
   *
   * @returns ResultAsync with void on success (returns ok even if execution not found - defensive behavior)
   */
  fail(
    executionId: string,
    lastKnownState: string,
  ): ResultAsync<void, ExecutionTrackerError>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Create execution tracker service
 */
export function createExecutionTracker(
  options: ExecutionTrackerOptions,
): ExecutionTracker {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for ExecutionTracker");
  if (!logger) throw new Error("logger is required for ExecutionTracker");

  return {
    start({
      agentType,
      issueId,
      workspaceId,
    }): ResultAsync<string, ExecutionTrackerError> {
      const id = createId.execution();
      const startedAt = new Date();

      return fromPromise(
        db.insert(agentExecutions).values({
          id,
          workspace_id: workspaceId,
          agent_type: agentType,
          issue_id: issueId,
          status: "started",
          started_at: startedAt,
        }),
        (error) => {
          logger.error(
            { err: error, agentType, issueId, workspaceId },
            "Failed to start execution tracking",
          );
          return new ExecutionTrackerError(
            "OBS_TRACKER_START",
            "Failed to start execution tracking",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { agentType, issueId, workspaceId },
            },
          );
        },
      ).map(() => {
        logger.info(
          { executionId: id, agentType, issueId, workspaceId },
          "Execution started",
        );
        return id;
      });
    },

    complete(executionId: string): ResultAsync<void, ExecutionTrackerError> {
      return fromPromise(
        completeExecution(db, logger, executionId),
        (error) => {
          logger.error(
            { err: error, executionId },
            "Failed to complete execution",
          );
          return new ExecutionTrackerError(
            "OBS_TRACKER_COMPLETE",
            "Failed to complete execution",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { executionId },
            },
          );
        },
      );
    },

    fail(
      executionId: string,
      lastKnownState: string,
    ): ResultAsync<void, ExecutionTrackerError> {
      return fromPromise(
        failExecution(db, logger, executionId, lastKnownState),
        (error) => {
          logger.error({ err: error, executionId }, "Failed to record failure");
          return new ExecutionTrackerError(
            "OBS_TRACKER_FAIL",
            "Failed to record execution failure",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { executionId, lastKnownState },
            },
          );
        },
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
      // No resources to clean up - db connection is managed externally
    },
  };
}

/**
 * Internal implementation of complete execution
 * Returns ok even if execution not found (defensive behavior for race conditions)
 */
async function completeExecution(
  db: PostgresJsDatabase,
  logger: PinoLogger,
  executionId: string,
): Promise<void> {
  const endedAt = new Date();

  // Fetch started_at to calculate duration
  const [row] = await db
    .select({ startedAt: agentExecutions.started_at })
    .from(agentExecutions)
    .where(eq(agentExecutions.id, executionId));

  if (!row) {
    logger.warn({ executionId }, "Execution not found for completion");
    return;
  }

  const durationMs = endedAt.getTime() - row.startedAt.getTime();

  await db
    .update(agentExecutions)
    .set({
      status: "completed",
      ended_at: endedAt,
      duration_ms: durationMs,
    })
    .where(eq(agentExecutions.id, executionId));

  logger.info(
    { executionId, durationMs, status: "completed" },
    "Execution completed",
  );
}

/**
 * Internal implementation of fail execution
 * Returns ok even if execution not found (defensive behavior for race conditions)
 */
async function failExecution(
  db: PostgresJsDatabase,
  logger: PinoLogger,
  executionId: string,
  lastKnownState: string,
): Promise<void> {
  const endedAt = new Date();

  // Fetch started_at to calculate duration
  const [row] = await db
    .select({ startedAt: agentExecutions.started_at })
    .from(agentExecutions)
    .where(eq(agentExecutions.id, executionId));

  if (!row) {
    logger.warn({ executionId }, "Execution not found for failure");
    return;
  }

  const durationMs = endedAt.getTime() - row.startedAt.getTime();

  await db
    .update(agentExecutions)
    .set({
      status: "failed",
      ended_at: endedAt,
      duration_ms: durationMs,
      last_known_state: lastKnownState,
    })
    .where(eq(agentExecutions.id, executionId));

  logger.error(
    { executionId, durationMs, lastKnownState, status: "failed" },
    "Execution failed",
  );
}
