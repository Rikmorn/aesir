/**
 * Linear Token Store
 *
 * Database-backed storage for Linear OAuth tokens with encryption.
 * Replaces file-based .tokens/linear.json storage.
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

// =============================================================================
// Legacy file-based functions (deprecated - kept for migration only)
// =============================================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_TOKEN_FILE = ".tokens/linear.json";

/**
 * Error thrown when token file is missing
 * @deprecated Use CredentialNotFoundError instead
 */
export class TokenFileNotFoundError extends Error {
  constructor(tokenFile: string) {
    super(
      `Linear tokens not found at "${tokenFile}". ` +
        `Run "npm run linear-oauth" to authorize and obtain tokens.`,
    );
    this.name = "TokenFileNotFoundError";
  }
}

/**
 * Error thrown when token file has invalid format
 * @deprecated File-based storage is deprecated
 */
export class InvalidTokenFileError extends Error {
  constructor(tokenFile: string, reason: string) {
    super(`Invalid token file at "${tokenFile}": ${reason}`);
    this.name = "InvalidTokenFileError";
  }
}

/**
 * @deprecated Use loadLinearTokens() instead (database-backed)
 * Load Linear OAuth tokens from a JSON file (legacy)
 */
export async function loadLinearTokensFromFile(
  tokenFile: string = DEFAULT_TOKEN_FILE,
): Promise<LinearConfig> {
  let content: string;

  try {
    content = await readFile(tokenFile, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new TokenFileNotFoundError(tokenFile);
    }
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new InvalidTokenFileError(tokenFile, "Invalid JSON format");
  }

  if (typeof data !== "object" || data === null) {
    throw new InvalidTokenFileError(tokenFile, "Expected object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.accessToken !== "string" || !obj.accessToken) {
    throw new InvalidTokenFileError(
      tokenFile,
      "Missing or invalid accessToken",
    );
  }

  if (typeof obj.expiresAt !== "number" || obj.expiresAt <= 0) {
    throw new InvalidTokenFileError(tokenFile, "Missing or invalid expiresAt");
  }

  const config: LinearConfig = {
    accessToken: obj.accessToken,
    expiresAt: obj.expiresAt,
  };

  if (typeof obj.refreshToken === "string" && obj.refreshToken) {
    config.refreshToken = obj.refreshToken;
  }

  return config;
}

/**
 * @deprecated Use saveLinearTokens() instead (database-backed)
 * Save Linear OAuth tokens to a JSON file (legacy)
 */
export async function saveLinearTokensToFile(
  config: LinearConfig,
  tokenFile: string = DEFAULT_TOKEN_FILE,
): Promise<void> {
  const data = {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt,
  };

  await mkdir(path.dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * @deprecated Use createLinearClientFromDatabase() instead
 * Create a LinearClient from a token file (legacy)
 */
export async function createLinearClientFromFile(
  tokenFile: string = DEFAULT_TOKEN_FILE,
): Promise<LinearClient> {
  const config = await loadLinearTokensFromFile(tokenFile);

  const onTokenRefresh = async (newConfig: LinearConfig): Promise<void> => {
    await saveLinearTokensToFile(newConfig, tokenFile);
  };

  return createLinearClient(config, onTokenRefresh);
}
