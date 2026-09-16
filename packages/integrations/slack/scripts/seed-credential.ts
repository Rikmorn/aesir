#!/usr/bin/env bun
/**
 * Seed Slack Credential from Environment
 *
 * Reads SLACK_BOT_TOKEN from environment and stores it encrypted
 * in the slack.installations table for team "default".
 *
 * Follows the same pattern as the Linear and GitHub credential seeders.
 *
 * Run with: pnpm --filter @aesir/integration-slack seed:credential
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { createId } from "@aesir/types";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { encryptToken } from "../src/db/encryption.js";
import { installations } from "../src/db/schema.js";

const DEFAULT_TEAM_ID = "default";

async function main() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.error("SLACK_BOT_TOKEN is not set. Add it to your .env file.");
    process.exit(1);
  }

  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error(
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate with: openssl rand -hex 32",
    );
    process.exit(1);
  }

  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER ?? "aesir"}:${process.env.DB_PASSWORD ?? "aesir"}@${process.env.DB_HOST ?? "localhost"}:${process.env.DB_PORT ?? "5432"}/${process.env.DB_NAME ?? "aesir"}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log(`Seeding Slack credential for team: ${DEFAULT_TEAM_ID}`);

  // Hard-delete any existing installation for this team
  // (unique constraint on (team_id, enterprise_id) doesn't filter by deleted_at,
  //  so soft-delete would prevent re-insert)
  const existing = await db
    .select({ id: installations.id })
    .from(installations)
    .where(
      and(
        eq(installations.team_id, DEFAULT_TEAM_ID),
        isNull(installations.enterprise_id),
      ),
    );

  if (existing.length > 0) {
    console.log(
      `  Deleting ${existing.length} existing installation(s) for team`,
    );
    await db
      .delete(installations)
      .where(
        and(
          eq(installations.team_id, DEFAULT_TEAM_ID),
          isNull(installations.enterprise_id),
        ),
      );
  }

  // Encrypt and insert
  const encryptedBotToken = encryptToken(botToken);
  const id = createId.credential();

  // Default scopes for the Aesir Slack bot
  const defaultScopes = [
    "app_mentions:read",
    "chat:write",
    "channels:history",
    "im:history",
    "groups:history",
  ];

  await db.insert(installations).values({
    id,
    team_id: DEFAULT_TEAM_ID,
    is_enterprise_install: false,
    encrypted_bot_token: encryptedBotToken,
    bot_scopes: defaultScopes.join(","),
    token_type: "bot",
  });

  console.log(`  Stored bot token as installation: ${id}`);
  console.log("Done.");

  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
