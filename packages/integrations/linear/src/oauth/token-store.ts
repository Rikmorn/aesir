/**
 * Linear OAuth Token Store
 *
 * High-level functions for loading and saving OAuth tokens using Linear's
 * credential store. Provides simple interface for token persistence.
 */

import { createPinoLogger } from "@aesir/platform";
import type { LinearOAuthConfig } from "../client/types.js";
import { db } from "../db/client.js";
import {
  createLinearCredentialStore,
  type DecryptedCredential,
} from "../db/credential-store.js";
import { LinearError } from "../types/errors.js";

const logger = createPinoLogger({ component: "integrations:linear:oauth" });

/** Default workspace ID for single-tenant deployments */
export const DEFAULT_WORKSPACE_ID = "ws_default";

/**
 * Error thrown when credential is not found in database
 */
export class CredentialNotFoundError extends LinearError {
  constructor(workspaceId: string) {
    super(
      "INT_LINEAR_TOKEN",
      `Linear credential not found for workspace: ${workspaceId}. Run OAuth flow to authenticate.`,
      {
        metadata: { workspaceId },
        recovery: {
          isRecoverable: true,
          hint: "Run the OAuth flow to authenticate with Linear: npm run linear-oauth",
        },
      },
    );
    this.name = "CredentialNotFoundError";
  }
}

/**
 * Load Linear OAuth tokens from database
 *
 * @param workspaceId - Workspace ID (defaults to ws_default)
 * @returns LinearOAuthConfig with tokens
 * @throws CredentialNotFoundError if credential not found
 */
export async function loadLinearTokens(
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<LinearOAuthConfig> {
  logger.debug({ workspaceId }, "Loading Linear tokens from database");

  // Type assertion: db is NodePgDatabase but credential store expects PostgresJsDatabase
  // Both are compatible Drizzle interfaces with the same operations
  // biome-ignore lint/suspicious/noExplicitAny: Database type mismatch between node-postgres and postgres-js drivers
  const store = createLinearCredentialStore({ db: db as any, logger });
  const result = await store.getByWorkspace(workspaceId);

  if (result.isErr()) {
    logger.error(
      { err: result.error, workspaceId },
      "Failed to load Linear tokens",
    );
    throw result.error;
  }

  const credential = result.value;
  if (!credential) {
    logger.warn({ workspaceId }, "Linear credential not found");
    throw new CredentialNotFoundError(workspaceId);
  }

  logger.info({ workspaceId }, "Linear tokens loaded successfully");
  return credentialToConfig(credential);
}

/**
 * Save Linear OAuth tokens to database
 *
 * @param config - OAuth configuration to store
 * @param workspaceId - Workspace ID (defaults to ws_default)
 * @returns Credential ID
 */
export async function saveLinearTokens(
  config: LinearOAuthConfig,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<string> {
  logger.debug({ workspaceId }, "Saving Linear tokens to database");

  // Type assertion: db is NodePgDatabase but credential store expects PostgresJsDatabase
  // Both are compatible Drizzle interfaces with the same operations
  // biome-ignore lint/suspicious/noExplicitAny: Database type mismatch between node-postgres and postgres-js drivers
  const store = createLinearCredentialStore({ db: db as any, logger });

  // Build input with conditional property assignment for exactOptionalPropertyTypes
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment workaround for exactOptionalPropertyTypes
  const input: any = {
    workspaceId,
    accessToken: config.accessToken,
    expiresAt: new Date(config.expiresAt),
  };
  if (config.refreshToken !== undefined) {
    input.refreshToken = config.refreshToken;
  }

  const result = await store.store(input);

  if (result.isErr()) {
    logger.error(
      { err: result.error, workspaceId },
      "Failed to save Linear tokens",
    );
    throw result.error;
  }

  const credentialId = result.value;
  logger.info(
    { workspaceId, credentialId },
    "Linear tokens saved successfully",
  );
  return credentialId;
}

/**
 * Convert database credential to OAuth config
 */
function credentialToConfig(
  credential: DecryptedCredential,
): LinearOAuthConfig {
  // Build config with conditional property assignment for exactOptionalPropertyTypes
  const config: LinearOAuthConfig = {
    accessToken: credential.accessToken,
    expiresAt: credential.expiresAt?.getTime() ?? Date.now() + 315_360_000_000, // Default: 10 years
  };

  if (credential.refreshToken !== null) {
    config.refreshToken = credential.refreshToken;
  }

  return config;
}
