#!/usr/bin/env -S npx tsx -r dotenv-flow/config
/**
 * Linear Credential Migration Script
 *
 * Migrates Linear OAuth credentials from integrations.credentials to linear.credentials.
 * This is part of Linear extraction to its own package with isolated schema namespace.
 *
 * Run from project root:
 *   pnpm --filter @aesir/integration-linear migrate
 *
 * Or directly:
 *   npx tsx -r dotenv-flow/config packages/integrations/linear/scripts/migrate-credentials.ts
 *
 * This script uses direct database connection to avoid full environment validation.
 * Only database env vars are required.
 *
 * This script is idempotent - running it multiple times is safe.
 * It skips credentials that already exist in linear.credentials.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import pg from "pg";

// Environment variables loaded via -r dotenv-flow/config flag
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

const { Pool } = pg;

// Define schemas inline to avoid importing from schema files (which import dependencies)
const integrationsSchema = pgSchema("integrations");
const integrationCredentials = integrationsSchema.table("credentials", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  provider: text("provider").notNull(),
  encrypted_access_token: text("encrypted_access_token").notNull(),
  encrypted_refresh_token: text("encrypted_refresh_token"),
  token_type: text("token_type").default("Bearer"),
  scope: text("scope"),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

const linearSchema = pgSchema("linear");
const linearCredentials = linearSchema.table("credentials", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  encrypted_access_token: text("encrypted_access_token").notNull(),
  encrypted_refresh_token: text("encrypted_refresh_token"),
  token_type: text("token_type").default("Bearer"),
  scope: text("scope"),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

// Simple logger for migration script (uses console since this runs standalone)
const log = {
  info: (obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === "string") {
      console.log(`[INFO] ${obj}`);
    } else {
      console.log(`[INFO] ${msg}`, JSON.stringify(obj, null, 2));
    }
  },
  error: (obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === "string") {
      console.error(`[ERROR] ${obj}`);
    } else {
      console.error(`[ERROR] ${msg}`, JSON.stringify(obj, null, 2));
    }
  },
};

async function migrate(): Promise<void> {
  log.info("Starting Linear credential migration...");

  // Get database config from environment
  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = Number.parseInt(process.env.DB_PORT || "5432", 10);
  const dbUser = process.env.DB_USER || "temporal";
  const dbPassword = process.env.DB_PASSWORD || "temporal";
  const dbName = process.env.DB_NAME || "temporal";

  // Create direct database connection
  const pool = new Pool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  });

  const db = drizzle(pool);

  try {
    // Step 1: Check if linear schema exists, if not run migration
    log.info("Checking if linear schema exists...");
    const schemaCheck = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'linear'",
    );

    if (schemaCheck.rows.length === 0) {
      log.info("Linear schema does not exist, creating it...");
      const migrationPath = resolve(
        packageRoot,
        "src/db/migrations/0000_create_linear_schema.sql",
      );
      const migrationSql = await readFile(migrationPath, "utf-8");
      await pool.query(migrationSql);
      log.info("Linear schema created successfully");
    } else {
      log.info("Linear schema already exists");
    }

    // Step 2: Query existing Linear credentials from integrations.credentials
    log.info("Querying Linear credentials from integrations.credentials...");
    const existingCredentials = await db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.provider, "linear"),
          isNull(integrationCredentials.deleted_at),
        ),
      );

    log.info(
      { count: existingCredentials.length },
      "Found Linear credentials in integrations.credentials",
    );

    if (existingCredentials.length === 0) {
      log.info("No Linear credentials to migrate");
      return;
    }

    // Step 3: Migrate each credential
    let migratedCount = 0;
    let skippedCount = 0;

    for (const credential of existingCredentials) {
      // Check if already exists in linear.credentials by workspace_id
      const existing = await db
        .select({ id: linearCredentials.id })
        .from(linearCredentials)
        .where(
          and(
            eq(linearCredentials.workspace_id, credential.workspace_id),
            isNull(linearCredentials.deleted_at),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        log.info(
          { workspace_id: credential.workspace_id },
          "Credential already exists in linear.credentials, skipping",
        );
        skippedCount++;
        continue;
      }

      // Insert into linear.credentials (copy all fields except provider)
      await db.insert(linearCredentials).values({
        id: credential.id, // Reuse existing ID
        workspace_id: credential.workspace_id,
        encrypted_access_token: credential.encrypted_access_token,
        encrypted_refresh_token: credential.encrypted_refresh_token,
        token_type: credential.token_type,
        scope: credential.scope,
        expires_at: credential.expires_at,
        created_at: credential.created_at,
        updated_at: credential.updated_at,
        deleted_at: credential.deleted_at,
      });

      log.info(
        {
          id: credential.id,
          workspace_id: credential.workspace_id,
        },
        "Migrated credential to linear.credentials",
      );
      migratedCount++;
    }

    // Step 4: Log migration summary
    log.info("Migration complete!");
    log.info(
      {
        total_found: existingCredentials.length,
        migrated: migratedCount,
        skipped: skippedCount,
      },
      "Migration summary",
    );
  } finally {
    await pool.end();
  }
}

migrate()
  .then(() => {
    log.info("Migration script completed successfully");
    process.exit(0);
  })
  .catch((err: unknown) => {
    log.error({ err: String(err) }, "Migration failed");
    process.exit(1);
  });
