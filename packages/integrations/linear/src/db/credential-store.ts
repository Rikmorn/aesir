/**
 * Linear Credential Store
 *
 * Database-backed storage for Linear OAuth tokens with application-level encryption.
 * Linear-specific implementation without provider field (only one provider: Linear).
 *
 * All service boundary methods return ResultAsync for explicit error handling.
 */

import { createId } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fromPromise, type ResultAsync } from "neverthrow";
import { LinearError } from "../types/errors.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { type Credential, credentials } from "./schema.js";

/** Input for storing a credential */
export interface StoreCredentialInput {
  workspaceId: string;
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
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Options for creating a Linear credential store */
export interface LinearCredentialStoreOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

/** Linear credential store service interface */
export interface LinearCredentialStore {
  /**
   * Store a credential with encryption
   *
   * If a credential already exists for the workspace, it is soft-deleted
   * and a new one is created (ensures single active credential per workspace).
   *
   * @param input - Credential data to store
   * @returns ResultAsync with credential ID or LinearError
   */
  store(input: StoreCredentialInput): ResultAsync<string, LinearError>;

  /**
   * Get a credential by ID with decryption
   *
   * @param id - Credential ID
   * @returns ResultAsync with decrypted credential or null if not found
   */
  get(id: string): ResultAsync<DecryptedCredential | null, LinearError>;

  /**
   * Get active credential for a workspace
   *
   * @param workspaceId - Workspace ID
   * @returns ResultAsync with decrypted credential or null if not found
   */
  getByWorkspace(
    workspaceId: string,
  ): ResultAsync<DecryptedCredential | null, LinearError>;

  /**
   * Update a credential's tokens
   *
   * Used for token refresh.
   *
   * @param id - Credential ID
   * @param tokens - New token values
   * @returns ResultAsync with void or LinearError
   */
  updateTokens(
    id: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    },
  ): ResultAsync<void, LinearError>;

  /**
   * Soft-delete a credential
   *
   * @param id - Credential ID
   * @returns ResultAsync with true if deleted, false if not found
   */
  delete(id: string): ResultAsync<boolean, LinearError>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Create a Linear credential store service
 *
 * Factory function for dependency-injected credential store.
 * Factory validation throws errors (startup fail-fast behavior).
 * Service methods return ResultAsync (service boundary calls).
 *
 * @param options - Database and logger dependencies
 * @returns LinearCredentialStore instance
 */
export function createLinearCredentialStore(
  options: LinearCredentialStoreOptions,
): LinearCredentialStore {
  const { db, logger } = options;

  // Factory validation - throws are OK here (startup fail-fast)
  if (!db) throw new Error("db is required for LinearCredentialStore");
  if (!logger) throw new Error("logger is required for LinearCredentialStore");

  return {
    store(input: StoreCredentialInput): ResultAsync<string, LinearError> {
      return fromPromise(storeCredentialImpl(db, logger, input), (error) => {
        logger.error(
          {
            err: error,
            workspaceId: input.workspaceId,
          },
          "Failed to store Linear credential",
        );
        return new LinearError(
          "INT_LINEAR_TOKEN",
          "Failed to store credential",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: {
              workspaceId: input.workspaceId,
            },
          },
        );
      });
    },

    get(id: string): ResultAsync<DecryptedCredential | null, LinearError> {
      return fromPromise(getCredentialImpl(db, id), (error) => {
        logger.error({ err: error, id }, "Failed to get Linear credential");
        return new LinearError("INT_LINEAR_TOKEN", "Failed to get credential", {
          cause: error instanceof Error ? error : new Error(String(error)),
          metadata: { credentialId: id },
        });
      });
    },

    getByWorkspace(
      workspaceId: string,
    ): ResultAsync<DecryptedCredential | null, LinearError> {
      return fromPromise(getByWorkspaceImpl(db, workspaceId), (error) => {
        logger.error(
          { err: error, workspaceId },
          "Failed to get Linear credential by workspace",
        );
        return new LinearError(
          "INT_LINEAR_TOKEN",
          "Failed to get credential by workspace",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { workspaceId },
          },
        );
      });
    },

    updateTokens(
      id: string,
      tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
      },
    ): ResultAsync<void, LinearError> {
      return fromPromise(updateTokensImpl(db, logger, id, tokens), (error) => {
        logger.error(
          { err: error, id },
          "Failed to update Linear credential tokens",
        );
        return new LinearError(
          "INT_LINEAR_TOKEN",
          "Failed to update credential tokens",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { credentialId: id },
          },
        );
      });
    },

    delete(id: string): ResultAsync<boolean, LinearError> {
      return fromPromise(deleteCredentialImpl(db, logger, id), (error) => {
        logger.error({ err: error, id }, "Failed to delete Linear credential");
        return new LinearError(
          "INT_LINEAR_TOKEN",
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
    accessToken,
    refreshToken,
    tokenType = "Bearer",
    scope,
    expiresAt,
  } = input;

  logger.info({ workspaceId }, "Storing Linear credential");

  // Soft-delete existing credential for this workspace
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.workspace_id, workspaceId),
        isNull(credentials.deleted_at),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    logger.info(
      { workspaceId, existingId: existing[0].id },
      "Soft-deleting existing Linear credential",
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
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_type: tokenType,
    scope: scope ?? null,
    expires_at: expiresAt ?? null,
  });

  logger.info({ workspaceId, id }, "Linear credential stored");
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

async function getByWorkspaceImpl(
  db: PostgresJsDatabase,
  workspaceId: string,
): Promise<DecryptedCredential | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.workspace_id, workspaceId),
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

  logger.info({ id }, "Updating Linear credential tokens");

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
  logger.info({ id }, "Deleting Linear credential");

  // Check if credential exists and is not already deleted
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.id, id), isNull(credentials.deleted_at)))
    .limit(1);

  if (existing.length === 0) {
    logger.debug({ id }, "Linear credential not found or already deleted");
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
