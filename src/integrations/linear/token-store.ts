/**
 * Linear Token Store
 *
 * Utilities for loading and persisting Linear OAuth tokens from a JSON file.
 * Provides a factory function to create a LinearClient with automatic token
 * refresh and persistence.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { LinearClient } from "@linear/sdk";
import { createLinearClient } from "./client.js";
import type { LinearConfig } from "./types.js";

const DEFAULT_TOKEN_FILE = ".tokens/linear.json";

/**
 * Error thrown when token file is missing
 */
export class TokenFileNotFoundError extends Error {
  constructor(tokenFile: string) {
    super(
      `Linear tokens not found at "${tokenFile}". ` +
        `Run "npm run linear-oauth" to authorize and obtain tokens.`
    );
    this.name = "TokenFileNotFoundError";
  }
}

/**
 * Error thrown when token file has invalid format
 */
export class InvalidTokenFileError extends Error {
  constructor(tokenFile: string, reason: string) {
    super(`Invalid token file at "${tokenFile}": ${reason}`);
    this.name = "InvalidTokenFileError";
  }
}

/**
 * Load Linear OAuth tokens from a JSON file
 *
 * @param tokenFile - Path to the token file (default: .tokens/linear.json)
 * @returns LinearConfig with access token, refresh token, and expiration
 * @throws TokenFileNotFoundError if file doesn't exist
 * @throws InvalidTokenFileError if file format is invalid
 */
export async function loadLinearTokens(
  tokenFile: string = DEFAULT_TOKEN_FILE
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

  // Validate required fields
  if (typeof data !== "object" || data === null) {
    throw new InvalidTokenFileError(tokenFile, "Expected object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj["accessToken"] !== "string" || !obj["accessToken"]) {
    throw new InvalidTokenFileError(tokenFile, "Missing or invalid accessToken");
  }

  // refreshToken is optional - Linear may not return one depending on app config
  if (typeof obj["expiresAt"] !== "number" || obj["expiresAt"] <= 0) {
    throw new InvalidTokenFileError(tokenFile, "Missing or invalid expiresAt");
  }

  // Build config object conditionally to satisfy exactOptionalPropertyTypes
  const config: LinearConfig = {
    accessToken: obj["accessToken"],
    expiresAt: obj["expiresAt"],
  };

  if (typeof obj["refreshToken"] === "string" && obj["refreshToken"]) {
    config.refreshToken = obj["refreshToken"];
  }

  return config;
}

/**
 * Save Linear OAuth tokens to a JSON file
 *
 * @param config - Token configuration to save
 * @param tokenFile - Path to the token file (default: .tokens/linear.json)
 */
export async function saveLinearTokens(
  config: LinearConfig,
  tokenFile: string = DEFAULT_TOKEN_FILE
): Promise<void> {
  const data = {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt,
  };

  // Ensure directory exists
  await mkdir(path.dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600, // Restrictive permissions: owner read/write only
  });
}

/**
 * Create a LinearClient from a token file with automatic refresh persistence
 *
 * Loads tokens from the specified file and creates a client that automatically:
 * - Refreshes tokens when they're about to expire
 * - Persists refreshed tokens back to the file
 *
 * @param tokenFile - Path to the token file (default: .tokens/linear.json)
 * @returns LinearClient instance with valid access token
 * @throws TokenFileNotFoundError if file doesn't exist
 * @throws InvalidTokenFileError if file format is invalid
 *
 * @example
 * ```typescript
 * import { createLinearClientFromFile } from './integrations/linear/token-store.js';
 *
 * const client = await createLinearClientFromFile();
 * const me = await client.viewer;
 * console.log(`Logged in as ${me.name}`);
 * ```
 */
export async function createLinearClientFromFile(
  tokenFile: string = DEFAULT_TOKEN_FILE
): Promise<LinearClient> {
  const config = await loadLinearTokens(tokenFile);

  const onTokenRefresh = async (newConfig: LinearConfig): Promise<void> => {
    await saveLinearTokens(newConfig, tokenFile);
  };

  return createLinearClient(config, onTokenRefresh);
}
