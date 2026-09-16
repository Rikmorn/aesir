/**
 * Integration Test Setup
 *
 * Shared testcontainer lifecycle for all framework integration tests.
 * Boots a real PostgreSQL container, runs agents schema migrations,
 * and provides cleanup utilities.
 *
 * Usage:
 * ```typescript
 * let ctx: IntegrationTestContext;
 *
 * beforeAll(async () => {
 *   ctx = await setupTestContext();
 * }, 60000);
 *
 * afterAll(async () => {
 *   await teardownTestContext(ctx);
 * });
 *
 * afterEach(async () => {
 *   await cleanupTables(ctx);
 * });
 * ```
 */

// Set required env vars BEFORE any framework module imports
// to prevent process.exit(1) from shared/env/config.ts Zod validation.
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-key-not-real";
process.env.LINEAR_TEAM_ID = process.env.LINEAR_TEAM_ID || "test-team";
process.env.GITHUB_REPO = process.env.GITHUB_REPO || "test-org/test-repo";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C000TEST";
process.env.NODE_ENV = "test";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupPostgresContainer,
  type PostgresContainerContext,
  readJournalMigrations,
  runTestMigrations,
  setupPostgresContainer,
} from "@aesir/test-utils";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../shared/db/schema.js";

const { Pool } = pg;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationTestContext {
  /** The started PostgreSQL testcontainer context */
  container: PostgresContainerContext;
  /** pg Pool for direct SQL access */
  pool: InstanceType<typeof Pool>;
  /** Drizzle ORM instance with agents schema */
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** Connection URI for the test database */
  connectionUri: string;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Set up a PostgreSQL testcontainer with the agents schema.
 *
 * Creates a container, runs all agents migrations, and returns
 * a context object with pool, drizzle instance, and connection URI.
 *
 * Call in beforeAll with a generous timeout (60000ms).
 */
export async function setupTestContext(): Promise<IntegrationTestContext> {
  const container = await setupPostgresContainer();

  // The migrations the service itself applies, in journal order.
  await runTestMigrations(
    container.sql,
    await readJournalMigrations(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../shared/db/migrations",
      ),
    ),
  );

  // Create pg Pool from connection URI
  const pool = new Pool({ connectionString: container.connectionUri });

  // Create Drizzle instance with agents schema
  const db = drizzle(pool, { schema });

  return {
    container,
    pool,
    db,
    connectionUri: container.connectionUri,
  };
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

/**
 * Tear down the test context: close pool and stop container.
 * Call in afterAll.
 */
export async function teardownTestContext(
  ctx: IntegrationTestContext,
): Promise<void> {
  await ctx.pool.end();
  await cleanupPostgresContainer(ctx.container);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Truncate v2.3 agents tables between tests.
 *
 * Only truncates tables that the v2.3 framework uses:
 * - agents.agent_events (event log)
 * - agents.agent_sessions (session projection)
 * - agents.conversations (executor state)
 *
 * Does NOT truncate legacy tables (tasks, context_snapshots, execution_traces)
 * which may have FK issues and are not used by v2.3 tests.
 * Does NOT truncate pgboss.* tables.
 *
 * Call in afterEach for test isolation.
 */
export async function cleanupTables(
  ctx: IntegrationTestContext,
): Promise<void> {
  await ctx.container.sql.unsafe(
    `TRUNCATE agents.agent_events, agents.agent_sessions, agents.conversations CASCADE`,
  );
}
