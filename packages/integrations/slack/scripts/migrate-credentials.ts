#!/usr/bin/env -S npx tsx -r dotenv-flow/config
/**
 * Slack Credential Migration Script
 *
 * Migrates Slack OAuth credentials from environment variables to slack.installations.
 * This is part of Slack extraction to its own package with isolated schema namespace.
 *
 * Run from project root:
 *   pnpm --filter @aesir/integration-slack migrate
 *
 * Or directly:
 *   npx tsx -r dotenv-flow/config packages/integrations/slack/scripts/migrate-credentials.ts
 *
 * This script uses direct database connection to avoid full environment validation.
 * Only database env vars are required.
 *
 * This script is idempotent - running it multiple times is safe.
 * It skips installations that already exist in slack.installations.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  boolean,
  pgSchema,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import pg from "pg";

// Environment variables loaded via -r dotenv-flow/config flag
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

const { Pool } = pg;

// Define schema inline to avoid importing from schema files (which import dependencies)
const slackSchema = pgSchema("slack");
const slackInstallations = slackSchema.table(
  "installations",
  {
    id: text("id").primaryKey(),
    team_id: text("team_id").notNull(),
    enterprise_id: text("enterprise_id"),
    user_id: text("user_id"),
    is_enterprise_install: boolean("is_enterprise_install")
      .default(false)
      .notNull(),
    encrypted_bot_token: text("encrypted_bot_token").notNull(),
    encrypted_user_token: text("encrypted_user_token"),
    bot_id: text("bot_id"),
    bot_user_id: text("bot_user_id"),
    bot_scopes: text("bot_scopes"),
    app_id: text("app_id"),
    token_type: text("token_type").default("bot").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("installations_team_enterprise_unique").on(
      table.team_id,
      table.enterprise_id,
    ),
  ],
);

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
  log.info("Starting Slack credential migration...");

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
    // Step 1: Check if slack schema exists, if not run migration
    log.info("Checking if slack schema exists...");
    const schemaCheck = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'slack'",
    );

    if (schemaCheck.rows.length === 0) {
      log.info("Slack schema does not exist, creating it...");
      const migrationPath = resolve(
        packageRoot,
        "src/db/migrations/0000_create_slack_schema.sql",
      );
      const migrationSql = await readFile(migrationPath, "utf-8");
      await pool.query(migrationSql);
      log.info("Slack schema created successfully");
    } else {
      log.info("Slack schema already exists");
    }

    // Step 2: Check for SLACK_BOT_TOKEN environment variable
    const slackBotToken = process.env.SLACK_BOT_TOKEN;

    if (!slackBotToken) {
      log.info("No SLACK_BOT_TOKEN environment variable found");
      log.info("Migration complete - no credentials to migrate");
      return;
    }

    log.info(
      "Found SLACK_BOT_TOKEN environment variable, checking for existing installation...",
    );

    // Step 3: Check if installation already exists for default team
    const defaultTeamId = "default";
    const existing = await db
      .select({ id: slackInstallations.id })
      .from(slackInstallations)
      .where(
        and(
          eq(slackInstallations.team_id, defaultTeamId),
          isNull(slackInstallations.enterprise_id),
          isNull(slackInstallations.deleted_at),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      log.info(
        { teamId: defaultTeamId },
        "Installation already exists in slack.installations, skipping",
      );
      return;
    }

    // Step 4: Dynamically import credential store to avoid circular dependencies
    log.info(
      { teamId: defaultTeamId },
      "Migrating SLACK_BOT_TOKEN to database...",
    );

    const { createSlackCredentialStore } = await import(
      "../dist/db/credential-store.js"
    );
    const { createPinoLogger } = await import("@aesir/types");

    const logger = createPinoLogger({
      component: "integrations:slack:migration",
    });

    const credentialStore = createSlackCredentialStore({ db, logger });

    // Default scopes from 18-06 decision
    const defaultScopes = [
      "app_mentions:read",
      "chat:write",
      "channels:history",
      "im:history",
      "groups:history",
    ];

    const result = await credentialStore.storeInstallation({
      teamId: defaultTeamId,
      botToken: slackBotToken,
      botScopes: defaultScopes,
    });

    if (result.isOk()) {
      log.info(
        {
          id: result.value,
          teamId: defaultTeamId,
        },
        "SLACK_BOT_TOKEN migrated to slack.installations successfully",
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
