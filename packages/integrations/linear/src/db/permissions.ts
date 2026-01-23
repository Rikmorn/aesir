/**
 * MCP Tool Permission Checker for Linear Integration
 *
 * Implements database-backed permission checking with allow-list approach.
 * If no permission row exists, access is denied by default.
 */

import type { PinoLogger } from "@aesir/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mcpToolPermissions } from "./schema.js";

export interface CheckPermissionOptions {
  agentId: string;
  toolName: string;
}

export interface CheckPermissionDeps {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

/**
 * Check if an agent has permission to use a specific tool
 *
 * Uses allow-list approach:
 * - If row exists with allowed=true -> permitted
 * - If row exists with allowed=false -> denied
 * - If no row exists -> denied (default deny)
 *
 * @returns true if permitted, false otherwise
 */
export async function checkLinearToolPermission(
  deps: CheckPermissionDeps,
  options: CheckPermissionOptions,
): Promise<boolean> {
  const { db, logger } = deps;
  const { agentId, toolName } = options;

  const childLogger = logger.child({
    component: "integrations:linear:mcp:permissions",
    agentId,
    toolName,
  });

  try {
    const [permission] = await db
      .select({ allowed: mcpToolPermissions.allowed })
      .from(mcpToolPermissions)
      .where(
        and(
          eq(mcpToolPermissions.agentId, agentId),
          eq(mcpToolPermissions.toolName, toolName),
        ),
      )
      .limit(1);

    if (!permission) {
      childLogger.debug("No permission row found, defaulting to deny");
      return false;
    }

    childLogger.debug(
      { allowed: permission.allowed },
      "Permission check result",
    );
    return permission.allowed;
  } catch (error) {
    childLogger.error(
      { err: error },
      "Permission check failed, defaulting to deny",
    );
    return false;
  }
}

// Re-export the table type for use in migrations
export { mcpToolPermissions as LinearMcpToolPermissions };
