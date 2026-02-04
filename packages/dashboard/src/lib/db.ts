/**
 * Database Client
 *
 * Read-only Drizzle ORM client for the dashboard.
 * Connects to the agents schema in PostgreSQL.
 *
 * Uses local schema definitions (Approach B) to avoid coupling the dashboard
 * to the full @aesir/agents dependency tree. Schema changes are infrequent
 * and the dashboard only reads a subset of columns.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "aesir",
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
