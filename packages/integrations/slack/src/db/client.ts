/**
 * Slack Database Client
 *
 * PostgreSQL connection pool and Drizzle ORM client for Slack package.
 * Uses Slack-specific config and connects to slack.* schema namespace.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../types/config.js";

const { Pool } = pg;

/**
 * PostgreSQL connection pool
 *
 * Used for health checks and raw queries.
 */
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Drizzle ORM client
 *
 * Main interface for database operations.
 */
export const db = drizzle(pool);
