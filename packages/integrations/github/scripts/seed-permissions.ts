#!/usr/bin/env tsx
/**
 * Seed MCP Tool Permissions for GitHub Integration
 *
 * Creates default permissions for dev-agent and product-agent.
 * Run with: pnpm --filter @aesir/integration-github seed:permissions
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { mcpToolPermissions } from "../src/db/schema.js";

const PERMISSIONS = [
  // dev-agent: Full access (primary developer - all tools)
  { agentId: "dev-agent", toolName: "get_repository", allowed: true },
  { agentId: "dev-agent", toolName: "create_branch", allowed: true },
  { agentId: "dev-agent", toolName: "create_commit", allowed: true },
  { agentId: "dev-agent", toolName: "create_pull_request", allowed: true },
  { agentId: "dev-agent", toolName: "get_pull_request", allowed: true },
  { agentId: "dev-agent", toolName: "list_pull_requests", allowed: true },
  { agentId: "dev-agent", toolName: "merge_pull_request", allowed: true },
  { agentId: "dev-agent", toolName: "get_file_contents", allowed: true },
  { agentId: "dev-agent", toolName: "list_files", allowed: true },

  // product-agent: Read-only access (reviews code, no writes)
  { agentId: "product-agent", toolName: "get_repository", allowed: true },
  { agentId: "product-agent", toolName: "get_pull_request", allowed: true },
  { agentId: "product-agent", toolName: "list_pull_requests", allowed: true },
  { agentId: "product-agent", toolName: "get_file_contents", allowed: true },
  { agentId: "product-agent", toolName: "list_files", allowed: true },
];

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("Seeding GitHub MCP tool permissions...");

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
