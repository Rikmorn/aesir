/**
 * Cost Tracking
 *
 * Query-time aggregation of per-task token usage from execution_traces.
 * Uses SQL SUM for aggregation -- no materialized views needed at current scale.
 *
 * Expected data volumes: ~100-500 trace rows per task (one per LLM call + tool call),
 * ~10-50 tasks per day initially. Query-time aggregation via SUM/GROUP BY is trivial
 * at this scale. When a dashboard is built, a materialized view can be added without
 * changing the write path.
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Per-task token usage summary.
 */
export interface TaskTokenUsage {
  taskId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  traceCount: number;
}

/**
 * Query total token usage for a specific task.
 *
 * Aggregates all execution trace entries (across orchestrator and
 * all sub-agents) to produce a per-task token cost summary.
 *
 * @param db - Drizzle database instance
 * @param taskId - The task ID to query
 * @returns Token usage summary, or null if no traces exist for the task
 */
export async function getTaskTokenUsage(
  db: NodePgDatabase,
  taskId: string,
): Promise<TaskTokenUsage | null> {
  const result = await db.execute(sql`
    SELECT
      task_id,
      COALESCE(SUM(token_count_input), 0)::int AS total_input,
      COALESCE(SUM(token_count_output), 0)::int AS total_output,
      COALESCE(SUM(token_count_input) + SUM(token_count_output), 0)::int AS total_tokens,
      COUNT(*)::int AS trace_count
    FROM agents.execution_traces
    WHERE task_id = ${taskId}
    GROUP BY task_id
  `);

  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as Record<string, unknown>;
  return {
    taskId: String(row.task_id),
    totalInputTokens: Number(row.total_input),
    totalOutputTokens: Number(row.total_output),
    totalTokens: Number(row.total_tokens),
    traceCount: Number(row.trace_count),
  };
}
