#!/usr/bin/env tsx
/**
 * Seed GitHub Credential from Environment
 *
 * Reads GITHUB_TOKEN from environment and stores it encrypted
 * in the github.credentials table for owner "default".
 *
 * Follows the same pattern as the Linear credential seeder.
 *
 * Run with: pnpm --filter @aesir/integration-github seed:credential
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenvFlow from "dotenv-flow";

// Load .env from monorepo root (scripts run from package directory)
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(currentDir, "../../../../");
dotenvFlow.config({ path: monorepoRoot, silent: true });

import { createId } from "@aesir/types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { encryptToken } from "../src/db/encryption.js";
import { credentials } from "../src/db/schema.js";

const DEFAULT_OWNER = "default";

async function main() {
  const accessToken = process.env.GITHUB_TOKEN;
  if (!accessToken) {
    console.error("GITHUB_TOKEN is not set. Add it to your .env file.");
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
    `postgres://${process.env.DB_USER ?? "temporal"}:${process.env.DB_PASSWORD ?? "temporal"}@${process.env.DB_HOST ?? "localhost"}:${process.env.DB_PORT ?? "5432"}/${process.env.DB_NAME ?? "temporal"}`;

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log(`Seeding GitHub credential for owner: ${DEFAULT_OWNER}`);

  // Hard-delete any existing credentials for this owner
  // (unique constraint on owner doesn't filter by deleted_at,
  //  so soft-delete would prevent re-insert)
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.owner, DEFAULT_OWNER));

  if (existing.length > 0) {
    console.log(
      `  Deleting ${existing.length} existing credential(s) for owner`,
    );
    await db.delete(credentials).where(eq(credentials.owner, DEFAULT_OWNER));
  }

  // Encrypt and insert
  const encryptedToken = encryptToken(accessToken);
  const id = createId.credential();

  await db.insert(credentials).values({
    id,
    owner: DEFAULT_OWNER,
    encrypted_access_token: encryptedToken,
    token_type: "Bearer",
  });

  const tokenType = accessToken.startsWith("ghp_")
    ? "Personal access token"
    : "OAuth token";
  console.log(`  Stored ${tokenType} as credential: ${id}`);
  console.log("Done.");

  await client.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
