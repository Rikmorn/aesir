/**
 * Integrations Database Client
 *
 * Per-package Drizzle client with connection pooling.
 */

import { config, createPinoLogger } from "@aesir/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const logger = createPinoLogger({ component: "integrations:db" });

let pool: Pool | null = null;

/**
 * Get or create the database connection pool
 */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      logger.error({ err }, "Unexpected database pool error");
    });
  }
  return pool;
}

/**
 * Integrations database client
 */
export const db = drizzle(getPool(), { schema });

/**
 * Close database connections (for graceful shutdown)
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database pool closed");
  }
}
