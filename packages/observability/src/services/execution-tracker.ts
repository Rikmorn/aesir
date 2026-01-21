/**
 * Execution Tracker Service
 *
 * Records agent execution lifecycle: start, complete, fail.
 * Calculates duration_ms on completion/failure.
 */

import { createId, type PinoLogger } from "@aesir/common";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { agentExecutions } from "../db/schema.js";

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
   * @returns Execution ID (exec_xxx format)
   */
  start(params: StartExecutionParams): Promise<string>;

  /**
   * Mark execution as completed successfully
   * Calculates duration_ms from started_at
   */
  complete(executionId: string): Promise<void>;

  /**
   * Mark execution as failed
   * Captures last known state for debugging
   */
  fail(executionId: string, lastKnownState: string): Promise<void>;

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
    async start({ agentType, issueId, workspaceId }): Promise<string> {
      const id = createId.execution();
      const startedAt = new Date();

      await db.insert(agentExecutions).values({
        id,
        workspace_id: workspaceId,
        agent_type: agentType,
        issue_id: issueId,
        status: "started",
        started_at: startedAt,
      });

      logger.info(
        { executionId: id, agentType, issueId, workspaceId },
        "Execution started",
      );

      return id;
    },

    async complete(executionId: string): Promise<void> {
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
    },

    async fail(executionId: string, lastKnownState: string): Promise<void> {
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
