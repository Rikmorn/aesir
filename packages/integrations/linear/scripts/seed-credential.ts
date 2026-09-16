#!/usr/bin/env bun
/**
 * Seed Linear Credential from Environment
 *
 * Reads LINEAR_ACCESS_TOKEN from environment and stores it encrypted
 * in the linear.credentials table for workspace ws_default.
 *
 * Supports both API keys (lin_api_*) and OAuth access tokens.
 *
 * Run with: pnpm --filter @aesir/integration-linear seed:credential
 */

import { loadEnvFromRoot } from "@aesir/platform";

loadEnvFromRoot();

import { createId } from "@aesir/types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { encryptToken } from "../src/db/encryption.js";
import { credentials } from "../src/db/schema.js";

const WORKSPACE_ID = "ws_default";

async function main() {
  const accessToken = process.env.LINEAR_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("LINEAR_ACCESS_TOKEN is not set. Add it to your .env file.");
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
    `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log(`Seeding Linear credential for workspace: ${WORKSPACE_ID}`);

  // Hard-delete any existing credentials for this workspace
  // (unique constraint on workspace_id doesn't filter by deleted_at,
  //  so soft-delete would prevent re-insert)
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.workspace_id, WORKSPACE_ID));

  if (existing.length > 0) {
    console.log(
      `  Deleting ${existing.length} existing credential(s) for workspace`,
    );
    await db
      .delete(credentials)
      .where(eq(credentials.workspace_id, WORKSPACE_ID));
  }

  // Encrypt and insert
  const encryptedToken = encryptToken(accessToken);
  const id = createId.credential();

  await db.insert(credentials).values({
    id,
    workspace_id: WORKSPACE_ID,
    encrypted_access_token: encryptedToken,
    token_type: "Bearer",
  });

  const tokenType = accessToken.startsWith("lin_api_")
    ? "API key"
    : "OAuth token";
  console.log(`  Stored ${tokenType} as credential: ${id}`);
  console.log("Done.");

  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
