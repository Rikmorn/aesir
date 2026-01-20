/**
 * Credential Store
 *
 * Database-backed storage for OAuth tokens with application-level encryption.
 * Replaces file-based .tokens/ storage.
 */

import { createId, createPinoLogger } from "@aesir/common";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { type Credential, credentials } from "./schema.js";

const logger = createPinoLogger({ component: "integrations:credential-store" });

/** Provider types for credentials */
export type CredentialProvider = "linear" | "github" | "slack";

/** Input for storing a credential */
export interface StoreCredentialInput {
  workspaceId: string;
  provider: CredentialProvider;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
}

/** Decrypted credential output */
export interface DecryptedCredential {
  id: string;
  workspaceId: string;
  provider: CredentialProvider;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Store a credential with encryption
 *
 * If a credential already exists for the workspace+provider, it is soft-deleted
 * and a new one is created (ensures single active credential per provider).
 *
 * @param input - Credential data to store
 * @returns Created credential ID
 */
export async function storeCredential(
  input: StoreCredentialInput,
): Promise<string> {
  const {
    workspaceId,
    provider,
    accessToken,
    refreshToken,
    tokenType = "Bearer",
    scope,
    expiresAt,
  } = input;

  logger.info({ workspaceId, provider }, "Storing credential");

  // Soft-delete existing credential for this workspace+provider
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.workspace_id, workspaceId),
        eq(credentials.provider, provider),
        isNull(credentials.deleted_at),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    logger.info(
      { workspaceId, provider, existingId: existing[0].id },
      "Soft-deleting existing credential",
    );
    await db
      .update(credentials)
      .set({ deleted_at: new Date() })
      .where(eq(credentials.id, existing[0].id));
  }

  // Encrypt tokens
  const encryptedAccessToken = encryptToken(accessToken);
  const encryptedRefreshToken = refreshToken
    ? encryptToken(refreshToken)
    : null;

  // Insert new credential
  const id = createId.credential();
  await db.insert(credentials).values({
    id,
    workspace_id: workspaceId,
    provider,
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_type: tokenType,
    scope: scope ?? null,
    expires_at: expiresAt ?? null,
  });

  logger.info({ workspaceId, provider, id }, "Credential stored");
  return id;
}

/**
 * Get a credential by ID with decryption
 *
 * @param id - Credential ID
 * @returns Decrypted credential or null if not found/deleted
 */
export async function getCredential(
  id: string,
): Promise<DecryptedCredential | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), isNull(credentials.deleted_at)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return decryptCredentialRow(rows[0]);
}

/**
 * Get active credential for a workspace and provider
 *
 * @param workspaceId - Workspace ID
 * @param provider - Provider name
 * @returns Decrypted credential or null if not found
 */
export async function getCredentialByProvider(
  workspaceId: string,
  provider: CredentialProvider,
): Promise<DecryptedCredential | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.workspace_id, workspaceId),
        eq(credentials.provider, provider),
        isNull(credentials.deleted_at),
      ),
    )
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return decryptCredentialRow(rows[0]);
}

/**
 * Update a credential's tokens
 *
 * Used for token refresh.
 *
 * @param id - Credential ID
 * @param tokens - New token values
 */
export async function updateCredentialTokens(
  id: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  },
): Promise<void> {
  const { accessToken, refreshToken, expiresAt } = tokens;

  logger.info({ id }, "Updating credential tokens");

  await db
    .update(credentials)
    .set({
      encrypted_access_token: encryptToken(accessToken),
      encrypted_refresh_token: refreshToken
        ? encryptToken(refreshToken)
        : undefined,
      expires_at: expiresAt,
      updated_at: new Date(),
    })
    .where(eq(credentials.id, id));
}

/**
 * Soft-delete a credential
 *
 * @param id - Credential ID
 */
export async function deleteCredential(id: string): Promise<void> {
  logger.info({ id }, "Deleting credential");

  await db
    .update(credentials)
    .set({ deleted_at: new Date() })
    .where(eq(credentials.id, id));
}

/**
 * Decrypt a credential row from the database
 */
function decryptCredentialRow(row: Credential): DecryptedCredential {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider as CredentialProvider,
    accessToken: decryptToken(row.encrypted_access_token),
    refreshToken: row.encrypted_refresh_token
      ? decryptToken(row.encrypted_refresh_token)
      : null,
    tokenType: row.token_type ?? "Bearer",
    scope: row.scope,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
