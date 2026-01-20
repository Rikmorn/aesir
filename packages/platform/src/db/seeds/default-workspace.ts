/**
 * Default Workspace Seed
 *
 * Creates the default workspace for single-tenant operation.
 * Run with: pnpm --filter @aesir/platform db:seed
 *
 * This script uses direct database connection to avoid triggering
 * full environment validation from the main application.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Use drizzle schema to avoid @aesir/common dependency
import * as schema from "../schema.drizzle.js";

const { workspaces } = schema;

// Direct connection - only DB env vars needed
const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "temporal",
  password: process.env.DB_PASSWORD ?? "temporal",
  database: process.env.DB_NAME ?? "temporal",
});

const db = drizzle(pool, { schema });

const DEFAULT_WORKSPACE = {
  id: "ws_default",
  name: "Default Workspace",
  slug: "default",
};

async function seed() {
  // biome-ignore lint/suspicious/noConsole: CLI seed script uses console for output
  console.log("Seeding default workspace...");

  // Check if exists (idempotent)
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "default"))
    .limit(1);

  const existingWorkspace = existing[0];
  if (existingWorkspace) {
    // biome-ignore lint/suspicious/noConsole: CLI seed script uses console for output
    console.log("Default workspace already exists:", existingWorkspace.id);
    return;
  }

  // Insert
  const result = await db
    .insert(workspaces)
    .values(DEFAULT_WORKSPACE)
    .returning();

  const workspace = result[0];
  if (!workspace) {
    throw new Error("Failed to create workspace - no result returned");
  }

  // biome-ignore lint/suspicious/noConsole: CLI seed script uses console for output
  console.log("Created default workspace:", workspace.id);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    // biome-ignore lint/suspicious/noConsole: CLI seed script uses console for output
    console.error("Seed failed:", err);
    process.exit(1);
  });
