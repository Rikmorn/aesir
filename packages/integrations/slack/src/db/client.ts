/**
 * Slack Database Client
 *
 * PostgreSQL connection pool and Drizzle ORM client for Slack package.
 * Uses Slack-specific config and connects to slack.* schema namespace.
 *
 * IMPORTANT: Database connections are LAZY - created on first access.
 * This allows importing from @aesir/integration-slack without requiring DB config.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../types/config.js";

const { Pool } = pg;

// Lazy-loaded pool and db instances
let _pool: pg.Pool | null = null;
let Db: NodePgDatabase | null = null;

function getPool(): pg.Pool {
  if (_pool) return _pool;

  _pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  return _pool;
}

function getDb(): NodePgDatabase {
  if (Db) return Db;
  Db = drizzle(getPool());
  return Db;
}

/**
 * PostgreSQL connection pool (lazy-loaded)
 *
 * Used for health checks and raw queries.
 * Connection is created on first access.
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Drizzle ORM client (lazy-loaded)
 *
 * Main interface for database operations.
 * Connection is created on first access.
 */
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
