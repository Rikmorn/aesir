/**
 * Context Manager
 *
 * Factory producing a service for persisting semantic context snapshots
 * at Temporal activity boundaries.
 *
 * Written at the end of each activity with an LLM-generated summary and
 * programmatic extraction of key state. Read at the start of the next
 * activity to provide continuity across approval waits.
 *
 * Covers CTXM-01 (write snapshot), CTXM-03 (read latest), and
 * CTXM-04 (stage-specific reads). CTXM-05 (sub-agent briefing) is
 * deferred to Phase 30/31 per 29-RESEARCH.md architectural decision.
 */

import type { PinoLogger } from "@aesir/platform";
import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "./schema.js";
import { type ContextSnapshot, contextSnapshots } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextManagerOptions {
  /** Database client for snapshot persistence */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance (will be wrapped with component child) */
  logger: PinoLogger;
}

export interface WriteSnapshotParams {
  taskId: string;
  workflowId: string;
  agentType: string;
  stage: string;
  summary: string;
  completedActions?: string[];
  pendingIntent?: string;
  knownIssues?: string[];
  projectContext?: Record<string, unknown>;
  keyFiles?: string[];
  researchFindings?: unknown;
  plan?: unknown;
  toolCallCount: number;
  tokenCount: { input: number; output: number };
}

export interface ContextManager {
  /** Write a context snapshot at end of activity */
  writeSnapshot(params: WriteSnapshotParams): Promise<string>;
  /** Read the latest snapshot for a task+workflow combination */
  readLatestSnapshot(
    taskId: string,
    workflowId: string,
  ): Promise<ContextSnapshot | null>;
  /** Read the latest snapshot for a specific stage */
  readLatestSnapshotForStage(
    taskId: string,
    stage: string,
  ): Promise<ContextSnapshot | null>;
  /** Health check */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  /** Graceful shutdown */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a context manager service for snapshot persistence.
 *
 * Follows the dependency injection factory pattern established by
 * observability/execution-tracker.ts.
 */
export function createContextManager(
  options: ContextManagerOptions,
): ContextManager {
  const { db, logger: parentLogger } = options;

  if (!db) throw new Error("db is required for ContextManager");
  if (!parentLogger) throw new Error("logger is required for ContextManager");

  const logger = parentLogger.child({ component: "context-manager" });

  return {
    async writeSnapshot(params: WriteSnapshotParams): Promise<string> {
      if (!params.taskId) {
        throw new Error("taskId is required for writeSnapshot");
      }
      if (!params.workflowId) {
        throw new Error("workflowId is required for writeSnapshot");
      }
      if (!params.agentType) {
        throw new Error("agentType is required for writeSnapshot");
      }
      if (!params.stage) {
        throw new Error("stage is required for writeSnapshot");
      }
      if (!params.summary) {
        throw new Error("summary is required for writeSnapshot");
      }

      const rows = await db
        .insert(contextSnapshots)
        .values({
          task_id: params.taskId,
          workflow_id: params.workflowId,
          agent_type: params.agentType,
          stage: params.stage,
          summary: params.summary,
          completed_actions: params.completedActions ?? [],
          pending_intent: params.pendingIntent,
          known_issues: params.knownIssues ?? [],
          project_context: params.projectContext ?? {},
          key_files: params.keyFiles ?? [],
          research_findings: params.researchFindings,
          plan: params.plan,
          tool_call_count: params.toolCallCount,
          token_count: params.tokenCount,
        })
        .returning({ id: contextSnapshots.id });

      const row = rows[0];
      if (!row) {
        throw new Error("Failed to insert context snapshot - no row returned");
      }

      const snapshotId = row.id;

      logger.info(
        { snapshotId, taskId: params.taskId, stage: params.stage },
        "Context snapshot written",
      );

      return snapshotId;
    },

    async readLatestSnapshot(
      taskId: string,
      workflowId: string,
    ): Promise<ContextSnapshot | null> {
      const rows = await db
        .select()
        .from(contextSnapshots)
        .where(
          and(
            eq(contextSnapshots.task_id, taskId),
            eq(contextSnapshots.workflow_id, workflowId),
          ),
        )
        .orderBy(desc(contextSnapshots.created_at))
        .limit(1);

      return rows[0] ?? null;
    },

    async readLatestSnapshotForStage(
      taskId: string,
      stage: string,
    ): Promise<ContextSnapshot | null> {
      const rows = await db
        .select()
        .from(contextSnapshots)
        .where(
          and(
            eq(contextSnapshots.task_id, taskId),
            eq(contextSnapshots.stage, stage),
          ),
        )
        .orderBy(desc(contextSnapshots.created_at))
        .limit(1);

      return rows[0] ?? null;
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
      logger.info(
        "Context manager close called (no-op, pool managed externally)",
      );
    },
  };
}
