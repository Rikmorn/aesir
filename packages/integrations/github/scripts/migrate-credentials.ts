#!/usr/bin/env tsx
/**
 * GitHub Credential Migration Script
 *
 * Migrates GitHub OAuth credentials from integrations.credentials to github.credentials.
 * This is part of GitHub extraction to its own package with isolated schema namespace.
 *
 * Run from project root:
 *   pnpm --filter @aesir/integration-github migrate
 *
 * Or directly:
 *   npx tsx packages/integrations/github/scripts/migrate-credentials.ts
 *
 * This script uses direct database connection to avoid full environment validation.
 * Only database env vars are required.
 *
 * This script is idempotent - running it multiple times is safe.
 * It skips credentials that already exist in github.credentials.
 */
import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import pg from "pg";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

const { Pool } = pg;

// Define schemas inline to avoid importing from schema files (which import dependencies)
// Note: integrations.credentials schema defined but not used in this migration
// (GitHub uses env var directly, not migrating from integrations.credentials)
const integrationsSchema = pgSchema("integrations");
const _integrationCredentials = integrationsSchema.table("credentials", {
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

const githubSchema = pgSchema("github");
const githubCredentials = githubSchema.table("credentials", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  installation_id: text("installation_id"),
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
  log.info("Starting GitHub credential migration...");

  // Get database config from environment
  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = Number.parseInt(process.env.DB_PORT || "5432", 10);
  const dbUser = process.env.DB_USER || "aesir";
  const dbPassword = process.env.DB_PASSWORD || "aesir";
  const dbName = process.env.DB_NAME || "aesir";

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
    // Step 1: Check if github schema exists, if not run migration
    log.info("Checking if github schema exists...");
    const schemaCheck = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'github'",
    );

    if (schemaCheck.rows.length === 0) {
      log.info("GitHub schema does not exist, creating it...");
      const migrationPath = resolve(
        packageRoot,
        "src/db/migrations/0000_create_github_schema.sql",
      );
      const migrationSql = await readFile(migrationPath, "utf-8");
      await pool.query(migrationSql);
      log.info("GitHub schema created successfully");
    } else {
      log.info("GitHub schema already exists");
    }

    // Step 2: Check for GITHUB_TOKEN environment variable
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubToken) {
      log.info("No GITHUB_TOKEN environment variable found");
      log.info("Migration complete - no credentials to migrate");
      return;
    }

    log.info(
      "Found GITHUB_TOKEN environment variable, checking for existing credential...",
    );

    // Step 3: Check if credential already exists for default owner
    const defaultOwner = "default";
    const existing = await db
      .select({ id: githubCredentials.id })
      .from(githubCredentials)
      .where(
        and(
          eq(githubCredentials.owner, defaultOwner),
          isNull(githubCredentials.deleted_at),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      log.info(
        { owner: defaultOwner },
        "Credential already exists in github.credentials, skipping",
      );
      return;
    }

    // Step 4: Dynamically import credential store to avoid circular dependencies
    log.info({ owner: defaultOwner }, "Migrating GITHUB_TOKEN to database...");

    const { createGitHubCredentialStore } = await import(
      "../dist/db/credential-store.js"
    );
    const { createPinoLogger } = await import("@aesir/types");

    const logger = createPinoLogger({
      component: "integrations:github:migration",
    });

    const credentialStore = createGitHubCredentialStore({ db, logger });

    const result = await credentialStore.store({
      owner: defaultOwner,
      accessToken: githubToken,
      scope: "repo,read:org", // Default scope from 17-05 decision
    });

    if (result.isOk()) {
      log.info(
        {
          id: result.value,
          owner: defaultOwner,
        },
        "GITHUB_TOKEN migrated to github.credentials successfully",
      );
    } else {
      throw result.error;
    }

    log.info("Migration complete!");
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
