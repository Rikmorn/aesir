/**
 * Agents Database Client
 *
 * Per-package Drizzle client with connection pooling.
 */

import { createPinoLogger } from "@aesir/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const logger = createPinoLogger({ component: "agents:db" });

let pool: Pool | null = null;

/**
 * Get or create the database connection pool
 */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number.parseInt(process.env.DB_PORT || "5432", 10),
      user: process.env.DB_USER || "temporal",
      password: process.env.DB_PASSWORD || "temporal",
      database: process.env.DB_NAME || "temporal",
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
 * Agents database client
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
