/**
 * Linear Token Store
 *
 * Database-backed storage for Linear OAuth tokens with encryption.
 */

import { createPinoLogger } from "@aesir/common";
import type { LinearClient } from "@linear/sdk";

import {
  type DecryptedCredential,
  getCredentialByProvider,
  storeCredential,
  updateCredentialTokens,
} from "../db/credential-store.js";
import { createLinearClient } from "./client.js";
import type { LinearConfig } from "./types.js";

const logger = createPinoLogger({
  component: "integrations:linear:token-store",
});

/** Default workspace ID for single-tenant operation */
const DEFAULT_WORKSPACE_ID = "ws_default";

/**
 * Error thrown when Linear credential is not found in database
 */
export class CredentialNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(
      `Linear credential not found for workspace "${workspaceId}". ` +
        `Run "npm run linear-oauth" to authorize and store credentials.`,
    );
    this.name = "CredentialNotFoundError";
  }
}

/**
 * Load Linear OAuth tokens from database
 *
 * @param workspaceId - Workspace ID (default: ws_default)
 * @returns LinearConfig with access token, refresh token, and expiration
 * @throws CredentialNotFoundError if credential doesn't exist
 */
export async function loadLinearTokens(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): Promise<LinearConfig> {
  const credential = await getCredentialByProvider(workspaceId, "linear");

  if (!credential) {
    throw new CredentialNotFoundError(workspaceId);
  }

  return credentialToConfig(credential);
}

/**
 * Save Linear OAuth tokens to database
 *
 * @param config - Token configuration to save
 * @param workspaceId - Workspace ID (default: ws_default)
 * @returns Credential ID
 */
export async function saveLinearTokens(
  config: LinearConfig,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): Promise<string> {
  logger.info({ workspaceId }, "Saving Linear tokens to database");

  // Build input conditionally to satisfy exactOptionalPropertyTypes
  const input: Parameters<typeof storeCredential>[0] = {
    workspaceId,
    provider: "linear",
    accessToken: config.accessToken,
  };
  if (config.refreshToken) {
    input.refreshToken = config.refreshToken;
  }
  if (config.expiresAt) {
    input.expiresAt = new Date(config.expiresAt);
  }

  const id = await storeCredential(input);

  logger.info({ workspaceId, credentialId: id }, "Linear tokens saved");
  return id;
}

/**
 * Create a LinearClient from database credentials with automatic refresh persistence
 *
 * @param workspaceId - Workspace ID (default: ws_default)
 * @returns LinearClient instance with valid access token
 * @throws CredentialNotFoundError if credential doesn't exist
 */
export async function createLinearClientFromDatabase(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): Promise<LinearClient> {
  const credential = await getCredentialByProvider(workspaceId, "linear");

  if (!credential) {
    throw new CredentialNotFoundError(workspaceId);
  }

  const config = credentialToConfig(credential);

  const onTokenRefresh = async (newConfig: LinearConfig): Promise<void> => {
    logger.info(
      { workspaceId, credentialId: credential.id },
      "Refreshing Linear tokens",
    );

    // Build update object conditionally to satisfy exactOptionalPropertyTypes
    const tokenUpdate: Parameters<typeof updateCredentialTokens>[1] = {
      accessToken: newConfig.accessToken,
    };
    if (newConfig.refreshToken) {
      tokenUpdate.refreshToken = newConfig.refreshToken;
    }
    if (newConfig.expiresAt) {
      tokenUpdate.expiresAt = new Date(newConfig.expiresAt);
    }

    await updateCredentialTokens(credential.id, tokenUpdate);

    logger.info(
      { workspaceId, credentialId: credential.id },
      "Linear tokens refreshed",
    );
  };

  return createLinearClient(config, onTokenRefresh);
}

/**
 * Convert database credential to LinearConfig
 */
function credentialToConfig(credential: DecryptedCredential): LinearConfig {
  const config: LinearConfig = {
    accessToken: credential.accessToken,
    expiresAt:
      credential.expiresAt?.getTime() ?? Date.now() + 365 * 24 * 60 * 60 * 1000,
  };

  if (credential.refreshToken) {
    config.refreshToken = credential.refreshToken;
  }

  return config;
}
