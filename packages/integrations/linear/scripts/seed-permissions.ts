#!/usr/bin/env tsx
/**
 * Seed MCP Tool Permissions for Linear Integration
 *
 * Creates default permissions for dev-agent and product-agent.
 * Run with: pnpm --filter @aesir/integration-linear seed:permissions
 */

import "dotenv-flow/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { mcpToolPermissions } from "../src/db/schema.js";

const PERMISSIONS = [
  // dev-agent: Full read/write access to issues
  { agentId: "dev-agent", toolName: "get_issue", allowed: true },
  { agentId: "dev-agent", toolName: "create_issue", allowed: true },
  { agentId: "dev-agent", toolName: "update_issue_status", allowed: true },
  { agentId: "dev-agent", toolName: "list_teams", allowed: true },
  { agentId: "dev-agent", toolName: "list_labels", allowed: true },
  { agentId: "dev-agent", toolName: "create_comment", allowed: true },
  { agentId: "dev-agent", toolName: "search_issues", allowed: true },

  // product-agent: Full access (creates issues, manages workflow)
  { agentId: "product-agent", toolName: "get_issue", allowed: true },
  { agentId: "product-agent", toolName: "create_issue", allowed: true },
  { agentId: "product-agent", toolName: "update_issue_status", allowed: true },
  { agentId: "product-agent", toolName: "list_teams", allowed: true },
  { agentId: "product-agent", toolName: "list_labels", allowed: true },
  { agentId: "product-agent", toolName: "create_comment", allowed: true },
  { agentId: "product-agent", toolName: "search_issues", allowed: true },
];

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("Seeding Linear MCP tool permissions...");

  for (const permission of PERMISSIONS) {
    try {
      await db
        .insert(mcpToolPermissions)
        .values(permission)
        .onConflictDoUpdate({
          target: [mcpToolPermissions.agentId, mcpToolPermissions.toolName],
          set: { allowed: permission.allowed, updatedAt: new Date() },
        });
      console.log(
        `  ${permission.agentId} -> ${permission.toolName}: ${permission.allowed ? "allowed" : "denied"}`,
      );
    } catch (error) {
      console.error(
        `  Failed to set ${permission.agentId} -> ${permission.toolName}:`,
        error,
      );
    }
  }

  console.log("Done.");
  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
