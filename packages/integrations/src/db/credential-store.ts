/**
 * Credential Store
 *
 * Database-backed storage for OAuth tokens with application-level encryption.
 * Replaces file-based .tokens/ storage.
 *
 * All service boundary methods return ResultAsync for explicit error handling.
 */

import type { PinoLogger } from "@aesir/common";
import { createId, createPinoLogger } from "@aesir/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fromPromise, type ResultAsync } from "neverthrow";
import { CredentialError } from "../errors/index.js";
import { db as defaultDb } from "./client.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { type Credential, credentials } from "./schema.js";

const defaultLogger = createPinoLogger({
  component: "integrations:credential-store",
});

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

/** Options for creating a credential store */
export interface CredentialStoreOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

/** Credential store service interface */
export interface CredentialStore {
  /**
   * Store a credential with encryption
   *
   * If a credential already exists for the workspace+provider, it is soft-deleted
   * and a new one is created (ensures single active credential per provider).
   *
   * @param input - Credential data to store
   * @returns ResultAsync with credential ID or CredentialError
   */
  store(input: StoreCredentialInput): ResultAsync<string, CredentialError>;

  /**
   * Get a credential by ID with decryption
   *
   * @param id - Credential ID
   * @returns ResultAsync with decrypted credential or null if not found
   */
  get(id: string): ResultAsync<DecryptedCredential | null, CredentialError>;

  /**
   * Get active credential for a workspace and provider
   *
   * @param workspaceId - Workspace ID
   * @param provider - Provider name
   * @returns ResultAsync with decrypted credential or null if not found
   */
  getByProvider(
    workspaceId: string,
    provider: CredentialProvider,
  ): ResultAsync<DecryptedCredential | null, CredentialError>;

  /**
   * Update a credential's tokens
   *
   * Used for token refresh.
   *
   * @param id - Credential ID
   * @param tokens - New token values
   * @returns ResultAsync with void or CredentialError
   */
  updateTokens(
    id: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    },
  ): ResultAsync<void, CredentialError>;

  /**
   * Soft-delete a credential
   *
   * @param id - Credential ID
   * @returns ResultAsync with true if deleted, false if not found
   */
  delete(id: string): ResultAsync<boolean, CredentialError>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources (no-op for this service, but interface consistency)
   */
  close(): Promise<void>;
}

/**
 * Create a credential store service
 *
 * Factory function for dependency-injected credential store.
 * Factory validation throws errors (startup fail-fast behavior).
 * Service methods return ResultAsync (service boundary calls).
 *
 * @param options - Database and logger dependencies
 * @returns CredentialStore instance
 */
export function createCredentialStore(
  options: CredentialStoreOptions,
): CredentialStore {
  const { db, logger } = options;

  // Factory validation - throws are OK here (startup fail-fast)
  if (!db) throw new Error("db is required for CredentialStore");
  if (!logger) throw new Error("logger is required for CredentialStore");

  return {
    store(input: StoreCredentialInput): ResultAsync<string, CredentialError> {
      return fromPromise(storeCredentialImpl(db, logger, input), (error) => {
        logger.error(
          {
            err: error,
            workspaceId: input.workspaceId,
            provider: input.provider,
          },
          "Failed to store credential",
        );
        return new CredentialError(
          "INT_CRED_STORE",
          "Failed to store credential",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: {
              workspaceId: input.workspaceId,
              provider: input.provider,
            },
          },
        );
      });
    },

    get(id: string): ResultAsync<DecryptedCredential | null, CredentialError> {
      return fromPromise(getCredentialImpl(db, id), (error) => {
        logger.error({ err: error, id }, "Failed to get credential");
        return new CredentialError(
          "INT_CRED_DECRYPTION",
          "Failed to get credential",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { credentialId: id },
          },
        );
      });
    },

    getByProvider(
      workspaceId: string,
      provider: CredentialProvider,
    ): ResultAsync<DecryptedCredential | null, CredentialError> {
      return fromPromise(
        getByProviderImpl(db, workspaceId, provider),
        (error) => {
          logger.error(
            { err: error, workspaceId, provider },
            "Failed to get credential by provider",
          );
          return new CredentialError(
            "INT_CRED_DECRYPTION",
            "Failed to get credential by provider",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { workspaceId, provider },
            },
          );
        },
      );
    },

    updateTokens(
      id: string,
      tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
      },
    ): ResultAsync<void, CredentialError> {
      return fromPromise(updateTokensImpl(db, logger, id, tokens), (error) => {
        logger.error({ err: error, id }, "Failed to update credential tokens");
        return new CredentialError(
          "INT_CRED_STORE",
          "Failed to update credential tokens",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { credentialId: id },
          },
        );
      });
    },

    delete(id: string): ResultAsync<boolean, CredentialError> {
      return fromPromise(deleteCredentialImpl(db, logger, id), (error) => {
        logger.error({ err: error, id }, "Failed to delete credential");
        return new CredentialError(
          "INT_CRED_DELETE",
          "Failed to delete credential",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { credentialId: id },
          },
        );
      });
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        // Simple connectivity check
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - db connection is managed externally
    },
  };
}

// Internal implementation functions (throw is OK - wrapped by fromPromise)

async function storeCredentialImpl(
  db: PostgresJsDatabase,
  logger: PinoLogger,
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

async function getCredentialImpl(
  db: PostgresJsDatabase,
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

async function getByProviderImpl(
  db: PostgresJsDatabase,
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

async function updateTokensImpl(
  db: PostgresJsDatabase,
  logger: PinoLogger,
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

async function deleteCredentialImpl(
  db: PostgresJsDatabase,
  logger: PinoLogger,
  id: string,
): Promise<boolean> {
  logger.info({ id }, "Deleting credential");

  // Check if credential exists and is not already deleted
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.id, id), isNull(credentials.deleted_at)))
    .limit(1);

  if (existing.length === 0) {
    logger.debug({ id }, "Credential not found or already deleted");
    return false;
  }

  await db
    .update(credentials)
    .set({ deleted_at: new Date() })
    .where(eq(credentials.id, id));

  return true;
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

// Legacy store instance for deprecated functions
// Note: Type assertion needed because defaultDb is NodePgDatabase (node-postgres)
// while factory expects PostgresJsDatabase (same interface, different driver)
const legacyStore = createCredentialStore({
  db: defaultDb as unknown as PostgresJsDatabase,
  logger: defaultLogger,
});

/**
 * Store a credential with encryption
 *
 * If a credential already exists for the workspace+provider, it is soft-deleted
 * and a new one is created (ensures single active credential per provider).
 *
 * @deprecated Use createCredentialStore factory instead
 * @param input - Credential data to store
 * @returns Created credential ID
 */
export async function storeCredential(
  input: StoreCredentialInput,
): Promise<string> {
  const result = await legacyStore.store(input);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

/**
 * Get a credential by ID with decryption
 *
 * @deprecated Use createCredentialStore factory instead
 * @param id - Credential ID
 * @returns Decrypted credential or null if not found/deleted
 */
export async function getCredential(
  id: string,
): Promise<DecryptedCredential | null> {
  const result = await legacyStore.get(id);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

/**
 * Get active credential for a workspace and provider
 *
 * @deprecated Use createCredentialStore factory instead
 * @param workspaceId - Workspace ID
 * @param provider - Provider name
 * @returns Decrypted credential or null if not found
 */
export async function getCredentialByProvider(
  workspaceId: string,
  provider: CredentialProvider,
): Promise<DecryptedCredential | null> {
  const result = await legacyStore.getByProvider(workspaceId, provider);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

/**
 * Update a credential's tokens
 *
 * Used for token refresh.
 *
 * @deprecated Use createCredentialStore factory instead
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
  const result = await legacyStore.updateTokens(id, tokens);
  if (result.isErr()) {
    throw result.error;
  }
}

/**
 * Soft-delete a credential
 *
 * @deprecated Use createCredentialStore factory instead
 * @param id - Credential ID
 */
export async function deleteCredential(id: string): Promise<void> {
  const result = await legacyStore.delete(id);
  if (result.isErr()) {
    throw result.error;
  }
}
