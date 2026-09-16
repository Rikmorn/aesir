/**
 * PostgreSQL Testcontainer Setup
 *
 * Provides utilities for starting PostgreSQL containers for integration tests.
 * Uses static container pattern (one per suite) with transaction isolation.
 *
 * RESEARCH.md Pattern 2: Testcontainers with Transaction Isolation
 * - Container startup ~1500ms (one-time per suite)
 * - Transaction rollback ~300ms (per test)
 */

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";

export interface PostgresContainerContext {
  /** The started container instance */
  container: StartedPostgreSqlContainer;
  /** PostgreSQL connection (postgres.js) */
  sql: Sql;
  /** Connection URI for other drivers (drizzle, etc) */
  connectionUri: string;
}

export interface SetupPostgresContainerOptions {
  /** PostgreSQL image to use. Default: pgvector/pgvector:pg16 */
  image?: string;
  /** Database name. Default: test_db */
  database?: string;
}

/**
 * Set up a PostgreSQL container for integration tests.
 *
 * IMPORTANT: Call this in beforeAll, not beforeEach!
 * Container startup is slow (~1500ms). Use transaction isolation for test-level cleanup.
 *
 * @example
 * ```typescript
 * describe("Database tests", () => {
 *   let ctx: PostgresContainerContext;
 *
 *   beforeAll(async () => {
 *     ctx = await setupPostgresContainer();
 *   }, 60000);
 *
 *   afterAll(async () => {
 *     await cleanupPostgresContainer(ctx);
 *   });
 *
 *   // Use ctx.sql in tests...
 * });
 * ```
 */
export async function setupPostgresContainer(
  options: SetupPostgresContainerOptions = {},
): Promise<PostgresContainerContext> {
  // pgvector, not plain postgres: the agents migrations open with
  // CREATE EXTENSION vector, which the official image does not carry. pg16
  // keeps the major version these tests already ran on.
  const { image = "pgvector/pgvector:pg16", database = "test_db" } = options;

  const container = await new PostgreSqlContainer(image)
    .withDatabase(database)
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionUri = container.getConnectionUri();

  const sql = postgres(connectionUri, {
    // Connection pool settings for tests
    max: 10,
    idle_timeout: 20,
  });

  return {
    container,
    sql,
    connectionUri,
  };
}

/**
 * Clean up PostgreSQL container resources.
 * Call this in afterAll.
 */
export async function cleanupPostgresContainer(
  ctx: PostgresContainerContext,
): Promise<void> {
  await ctx.sql.end();
  await ctx.container.stop();
}

/**
 * Run migrations against the test database.
 *
 * @param sql - postgres.js connection
 * @param migrationSql - SQL string containing migration statements
 */
export async function runTestMigrations(
  sql: Sql,
  migrationSql: string,
): Promise<void> {
  await sql.unsafe(migrationSql);
}
