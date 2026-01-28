/**
 * GitHub Credential Store
 *
 * Database-backed storage for GitHub OAuth tokens with application-level encryption.
 * GitHub-specific implementation with owner field for org/user identification.
 *
 * All service boundary methods return ResultAsync for explicit error handling.
 */

import { createId } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromPromise, type ResultAsync } from "neverthrow";
import { GitHubError } from "../types/errors.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { type Credential, credentials } from "./schema.js";

/** Input for storing a credential */
export interface StoreCredentialInput {
  owner: string; // org or user - unique identifier for GitHub credentials
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
  installationId?: string; // for future GitHub Apps support
}

/** Decrypted credential output */
export interface DecryptedCredential {
  id: string;
  owner: string;
  installationId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Options for creating a GitHub credential store */
export interface GitHubCredentialStoreOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
}

/** GitHub credential store service interface */
export interface GitHubCredentialStore {
  /**
   * Store a credential with encryption
   *
   * If a credential already exists for the owner, it is soft-deleted
   * and a new one is created (ensures single active credential per owner).
   *
   * @param input - Credential data to store
   * @returns ResultAsync with credential ID or GitHubError
   */
  store(input: StoreCredentialInput): ResultAsync<string, GitHubError>;

  /**
   * Get a credential by ID with decryption
   *
   * @param id - Credential ID
   * @returns ResultAsync with decrypted credential or null if not found
   */
  get(id: string): ResultAsync<DecryptedCredential | null, GitHubError>;

  /**
   * Get active credential for an owner
   *
   * @param owner - Owner identifier (org or user)
   * @returns ResultAsync with decrypted credential or null if not found
   */
  getByOwner(
    owner: string,
  ): ResultAsync<DecryptedCredential | null, GitHubError>;

  /**
   * Update a credential's tokens
   *
   * Used for token refresh.
   *
   * @param id - Credential ID
   * @param tokens - New token values
   * @returns ResultAsync with void or GitHubError
   */
  updateTokens(
    id: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    },
  ): ResultAsync<void, GitHubError>;

  /**
   * Soft-delete a credential
   *
   * @param id - Credential ID
   * @returns ResultAsync with true if deleted, false if not found
   */
  delete(id: string): ResultAsync<boolean, GitHubError>;

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
 * Create a GitHub credential store service
 *
 * Factory function for dependency-injected credential store.
 * Factory validation throws errors (startup fail-fast behavior).
 * Service methods return ResultAsync (service boundary calls).
 *
 * @param options - Database and logger dependencies
 * @returns GitHubCredentialStore instance
 */
export function createGitHubCredentialStore(
  options: GitHubCredentialStoreOptions,
): GitHubCredentialStore {
  const { db, logger } = options;

  // Factory validation - throws are OK here (startup fail-fast)
  if (!db) throw new Error("db is required for GitHubCredentialStore");
  if (!logger) throw new Error("logger is required for GitHubCredentialStore");

  return {
    store(input: StoreCredentialInput): ResultAsync<string, GitHubError> {
      return fromPromise(storeCredentialImpl(db, logger, input), (error) => {
        logger.error(
          {
            err: error,
            owner: input.owner,
          },
          "Failed to store GitHub credential",
        );
        return new GitHubError(
          "INT_GITHUB_TOKEN",
          "Failed to store credential",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: {
              owner: input.owner,
            },
          },
        );
      });
    },

    get(id: string): ResultAsync<DecryptedCredential | null, GitHubError> {
      return fromPromise(getCredentialImpl(db, id), (error) => {
        logger.error({ err: error, id }, "Failed to get GitHub credential");
        return new GitHubError("INT_GITHUB_TOKEN", "Failed to get credential", {
          cause: error instanceof Error ? error : new Error(String(error)),
          metadata: { credentialId: id },
        });
      });
    },

    getByOwner(
      owner: string,
    ): ResultAsync<DecryptedCredential | null, GitHubError> {
      return fromPromise(getByOwnerImpl(db, owner), (error) => {
        logger.error(
          { err: error, owner },
          "Failed to get GitHub credential by owner",
        );
        return new GitHubError(
          "INT_GITHUB_TOKEN",
          "Failed to get credential by owner",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { owner },
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
    ): ResultAsync<void, GitHubError> {
      return fromPromise(updateTokensImpl(db, logger, id, tokens), (error) => {
        logger.error(
          { err: error, id },
          "Failed to update GitHub credential tokens",
        );
        return new GitHubError(
          "INT_GITHUB_TOKEN",
          "Failed to update credential tokens",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { credentialId: id },
          },
        );
      });
    },

    delete(id: string): ResultAsync<boolean, GitHubError> {
      return fromPromise(deleteCredentialImpl(db, logger, id), (error) => {
        logger.error({ err: error, id }, "Failed to delete GitHub credential");
        return new GitHubError(
          "INT_GITHUB_TOKEN",
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
  db: NodePgDatabase,
  logger: PinoLogger,
  input: StoreCredentialInput,
): Promise<string> {
  const {
    owner,
    accessToken,
    refreshToken,
    tokenType = "Bearer",
    scope,
    expiresAt,
    installationId,
  } = input;

  logger.info({ owner }, "Storing GitHub credential");

  // Soft-delete existing credential for this owner
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.owner, owner), isNull(credentials.deleted_at)))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    logger.info(
      { owner, existingId: existing[0].id },
      "Soft-deleting existing GitHub credential",
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
    owner,
    installation_id: installationId ?? null,
    encrypted_access_token: encryptedAccessToken,
    encrypted_refresh_token: encryptedRefreshToken,
    token_type: tokenType,
    scope: scope ?? null,
    expires_at: expiresAt ?? null,
  });

  logger.info({ owner, id }, "GitHub credential stored");
  return id;
}

async function getCredentialImpl(
  db: NodePgDatabase,
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

async function getByOwnerImpl(
  db: NodePgDatabase,
  owner: string,
): Promise<DecryptedCredential | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.owner, owner), isNull(credentials.deleted_at)))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return decryptCredentialRow(rows[0]);
}

async function updateTokensImpl(
  db: NodePgDatabase,
  logger: PinoLogger,
  id: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  },
): Promise<void> {
  const { accessToken, refreshToken, expiresAt } = tokens;

  logger.info({ id }, "Updating GitHub credential tokens");

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
  db: NodePgDatabase,
  logger: PinoLogger,
  id: string,
): Promise<boolean> {
  logger.info({ id }, "Deleting GitHub credential");

  // Check if credential exists and is not already deleted
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.id, id), isNull(credentials.deleted_at)))
    .limit(1);

  if (existing.length === 0) {
    logger.debug({ id }, "GitHub credential not found or already deleted");
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
    owner: row.owner,
    installationId: row.installation_id,
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
