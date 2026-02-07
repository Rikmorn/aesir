/**
 * Task Correlation Helpers
 *
 * Record and look up correlations between v2.5 task IDs and Slack resources.
 * Used bidirectionally:
 * - Record: When an agent sends a Slack message/approval via MCP, associate it with the task
 * - Lookup: When a Slack webhook arrives, find the originating task for routing context
 *
 * All operations are fire-and-forget -- failures are logged but never rethrown.
 */

import type { MCPLogger } from "@aesir/types";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Record a correlation between a task ID and an external Slack resource.
 *
 * No-op if taskId is undefined (agent called without task context).
 * Uses ON CONFLICT DO NOTHING to handle duplicate recordings gracefully.
 *
 * @param db - Drizzle database client
 * @param taskId - v2.5 task ID (undefined = no-op)
 * @param externalType - Resource type (e.g., "thread", "approval")
 * @param externalRef - Resource reference (e.g., "C1234:1234567890.123456")
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
      sql`INSERT INTO slack.task_correlations (external_type, external_ref, task_id)
          VALUES (${externalType}, ${externalRef}, ${taskId})
          ON CONFLICT (external_type, external_ref) DO NOTHING`,
    );
  } catch (error) {
    logger.error(
      { err: error, taskId, externalType, externalRef },
      "Failed to record task correlation (non-fatal)",
    );
  }
}

/**
 * Look up the task ID associated with an external Slack resource.
 *
 * Returns undefined if no correlation exists or on error.
 *
 * @param db - Drizzle database client
 * @param externalType - Resource type (e.g., "thread", "approval")
 * @param externalRef - Resource reference (e.g., "C1234:1234567890.123456")
 * @param logger - Logger for error reporting
 * @returns Task ID string or undefined
 */
export async function lookupTaskCorrelation(
  db: NodePgDatabase,
  externalType: string,
  externalRef: string,
  logger: MCPLogger,
): Promise<string | undefined> {
  try {
    const rows = await db.execute(
      sql`SELECT task_id FROM slack.task_correlations
          WHERE external_type = ${externalType} AND external_ref = ${externalRef}
          LIMIT 1`,
    );

    if (rows.rows.length === 0) return undefined;

    return (rows.rows[0] as { task_id: string }).task_id;
  } catch (error) {
    logger.error(
      { err: error, externalType, externalRef },
      "Failed to look up task correlation (non-fatal)",
    );
    return undefined;
  }
}
