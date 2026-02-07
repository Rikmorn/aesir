/**
 * GitHub Task Correlation Helpers
 *
 * Records and looks up correlations between GitHub resources (branches, commits, PRs)
 * and v2.5 task IDs. Used bidirectionally:
 *
 * - Recording (outgoing): When an agent creates a branch/commit/PR via MCP,
 *   the correlation is stored so we can later trace the resource back to its task.
 *
 * - Lookup (incoming): When a webhook arrives for a PR, we look up the correlation
 *   to attach the taskId to the IncomingEvent for correct conversation routing.
 *
 * Both operations are non-fatal: failures are logged but never propagated.
 */

import type { MCPLogger } from "@aesir/types";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Record a task correlation for a GitHub resource.
 *
 * Fire-and-forget: errors are logged but not rethrown.
 * Uses ON CONFLICT DO NOTHING so duplicate correlations are silently ignored.
 *
 * @param db - Database connection
 * @param taskId - v2.5 task ID (undefined = no-op)
 * @param externalType - Resource type (e.g., "branch", "commit", "pull_request")
 * @param externalRef - Resource reference (e.g., "owner/repo#42")
 * @param logger - Logger for error reporting
 */
export async function recordTaskCorrelation(
  db: NodePgDatabase,
  taskId: string | undefined,
  externalType: string,
  externalRef: string,
  logger: MCPLogger,
): Promise<void> {
  if (taskId === undefined) return;

  try {
    await db.execute(
      sql`INSERT INTO github.task_correlations (external_type, external_ref, task_id)
          VALUES (${externalType}, ${externalRef}, ${taskId})
          ON CONFLICT (external_type, external_ref) DO NOTHING`,
    );
    logger.debug(
      { taskId, externalType, externalRef },
      "Task correlation recorded",
    );
  } catch (error) {
    logger.error(
      { err: error, taskId, externalType, externalRef },
      "Failed to record task correlation (non-fatal)",
    );
  }
}

/**
 * Look up a task correlation for a GitHub resource.
 *
 * Non-fatal: errors are logged and undefined is returned.
 *
 * @param db - Database connection
 * @param externalType - Resource type (e.g., "pull_request")
 * @param externalRef - Resource reference (e.g., "owner/repo#42")
 * @param logger - Logger for error reporting
 * @returns task ID if found, undefined otherwise
 */
export async function lookupTaskCorrelation(
  db: NodePgDatabase,
  externalType: string,
  externalRef: string,
  logger: MCPLogger,
): Promise<string | undefined> {
  try {
    const rows = await db.execute(
      sql`SELECT task_id FROM github.task_correlations
          WHERE external_type = ${externalType} AND external_ref = ${externalRef}
          LIMIT 1`,
    );
    const firstRow = rows.rows[0] as { task_id: string } | undefined;
    if (firstRow?.task_id) {
      logger.debug(
        { externalType, externalRef, taskId: firstRow.task_id },
        "Task correlation found",
      );
      return firstRow.task_id;
    }
    return undefined;
  } catch (error) {
    logger.error(
      { err: error, externalType, externalRef },
      "Failed to look up task correlation (non-fatal)",
    );
    return undefined;
  }
}
