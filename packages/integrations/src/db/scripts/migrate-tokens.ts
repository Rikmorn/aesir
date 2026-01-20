/**
 * One-Time Token Migration Script
 *
 * Migrates Linear OAuth token from .tokens/linear.json to database.
 * Run with: pnpm --filter @aesir/integrations migrate-tokens
 *
 * This script uses direct database connection to avoid full environment validation.
 * Only database and encryption env vars are required.
 *
 * This script is idempotent - running it multiple times is safe.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenvFlow from "dotenv-flow";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import pg from "pg";

// Load environment variables from project root (bypasses full validation)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../../../../..");
dotenvFlow.config({ path: projectRoot });

const { Pool } = pg;

// Define credentials table inline to avoid importing from schema (which imports @aesir/common)
const integrationsSchema = pgSchema("integrations");
const credentials = integrationsSchema.table(
  "credentials",
  {
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
  },
  (table) => [
    unique("credentials_workspace_provider_unique").on(
      table.workspace_id,
      table.provider,
    ),
  ],
);

// Simple logger for migration script (uses console since this runs standalone)
const log = {
  info: (obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === "string") {
      // biome-ignore lint/suspicious/noConsole: Migration script uses console for output
      console.log(`[INFO] ${obj}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: Migration script uses console for output
      console.log(`[INFO] ${msg}`, JSON.stringify(obj));
    }
  },
  error: (obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === "string") {
      // biome-ignore lint/suspicious/noConsole: Migration script uses console for output
      console.error(`[ERROR] ${obj}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: Migration script uses console for output
      console.error(`[ERROR] ${msg}`, JSON.stringify(obj));
    }
  },
};

// Token file path relative to project root
const TOKEN_FILE = resolve(projectRoot, ".tokens/linear.json");
const WORKSPACE_ID = "ws_default";

interface TokenFile {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Generate a credential ID (simplified version of createId.credential)
 */
function createCredentialId(): string {
  return `cred_${nanoid(24)}`;
}

/**
 * Encrypt a token using AES-256-CBC
 * Simplified version for migration - inline implementation
 */
function encryptToken(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

async function migrate(): Promise<void> {
  log.info("Starting token migration...");

  // Get database config from environment
  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = Number.parseInt(process.env.DB_PORT || "5432", 10);
  const dbUser = process.env.DB_USER || "temporal";
  const dbPassword = process.env.DB_PASSWORD || "temporal";
  const dbName = process.env.DB_NAME || "temporal";
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!encryptionKey) {
    log.error(
      "CREDENTIAL_ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32",
    );
    process.exit(1);
  }

  if (encryptionKey.length !== 64) {
    log.error(
      `CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes), got ${encryptionKey.length} chars`,
    );
    process.exit(1);
  }

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
    // Check if already migrated
    const existing = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(
        and(
          eq(credentials.workspace_id, WORKSPACE_ID),
          eq(credentials.provider, "linear"),
          isNull(credentials.deleted_at),
        ),
      )
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      log.info(
        { credentialId: existing[0].id },
        "Linear credential already exists in database, skipping migration",
      );
      return;
    }

    // Read token file
    let tokenData: TokenFile;
    try {
      const content = await readFile(TOKEN_FILE, "utf-8");
      tokenData = JSON.parse(content) as TokenFile;
      log.info("Read token file successfully");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        log.info("No token file found, nothing to migrate");
        return;
      }
      throw err;
    }

    // Validate token data
    if (!tokenData.accessToken) {
      log.error("Token file missing accessToken, cannot migrate");
      return;
    }

    // Encrypt tokens
    const encryptedAccessToken = encryptToken(
      tokenData.accessToken,
      encryptionKey,
    );
    const encryptedRefreshToken = tokenData.refreshToken
      ? encryptToken(tokenData.refreshToken, encryptionKey)
      : null;

    // Insert credential
    const credentialId = createCredentialId();
    await db.insert(credentials).values({
      id: credentialId,
      workspace_id: WORKSPACE_ID,
      provider: "linear",
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      token_type: "Bearer",
      scope: null,
      expires_at: tokenData.expiresAt ? new Date(tokenData.expiresAt) : null,
    });

    log.info(
      { credentialId },
      "Linear token migrated to database successfully",
    );
  } finally {
    await pool.end();
  }
}

migrate()
  .then(() => {
    log.info("Migration complete");
    process.exit(0);
  })
  .catch((err: unknown) => {
    log.error({ err: String(err) }, "Migration failed");
    process.exit(1);
  });
