/**
 * GitHub OAuth Token Store
 *
 * High-level functions for loading and saving OAuth tokens using GitHub's
 * credential store. Provides simple interface for token persistence.
 */

import { createPinoLogger } from "@aesir/common";
import type { GitHubCredentialStore } from "../db/credential-store.js";

const logger = createPinoLogger({ component: "integrations:github:oauth" });

/** Default owner for single-tenant deployments */
export const DEFAULT_OWNER = "default";

/** GitHub OAuth tokens */
export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
}

/**
 * Load GitHub OAuth tokens from database
 *
 * @param credentialStore - GitHub credential store instance
 * @param owner - Owner identifier (org or user, defaults to "default")
 * @returns GitHubTokens or null if not found
 * @throws GitHubError if database operation fails
 */
export async function loadGitHubTokens(
  credentialStore: GitHubCredentialStore,
  owner: string,
): Promise<GitHubTokens | null> {
  logger.debug({ owner }, "Loading GitHub tokens from database");

  const result = await credentialStore.getByOwner(owner);

  return result.match(
    (credential) => {
      if (!credential) {
        logger.debug({ owner }, "GitHub credential not found");
        return null;
      }

      logger.debug({ owner }, "GitHub tokens loaded successfully");

      // Build tokens object with conditional property assignment
      const tokens: GitHubTokens = {
        accessToken: credential.accessToken,
      };

      if (credential.refreshToken !== null) {
        tokens.refreshToken = credential.refreshToken;
      }
      if (credential.tokenType) {
        tokens.tokenType = credential.tokenType;
      }
      if (credential.scope !== null) {
        tokens.scope = credential.scope;
      }
      if (credential.expiresAt !== null) {
        tokens.expiresAt = credential.expiresAt;
      }

      return tokens;
    },
    (error) => {
      logger.error({ err: error, owner }, "Failed to load GitHub tokens");
      throw error;
    },
  );
}

/**
 * Save GitHub OAuth tokens to database
 *
 * @param credentialStore - GitHub credential store instance
 * @param owner - Owner identifier (org or user)
 * @param tokens - OAuth tokens to store
 * @returns Credential ID
 * @throws GitHubError if database operation fails
 */
export async function saveGitHubTokens(
  credentialStore: GitHubCredentialStore,
  owner: string,
  tokens: GitHubTokens,
): Promise<string> {
  logger.info({ owner }, "Saving GitHub tokens to database");

  // Build input with conditional property assignment for exactOptionalPropertyTypes
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment workaround for exactOptionalPropertyTypes
  const input: any = {
    owner,
    accessToken: tokens.accessToken,
  };

  if (tokens.refreshToken !== undefined) {
    input.refreshToken = tokens.refreshToken;
  }
  if (tokens.tokenType !== undefined) {
    input.tokenType = tokens.tokenType;
  }
  if (tokens.scope !== undefined) {
    input.scope = tokens.scope;
  }
  if (tokens.expiresAt !== undefined) {
    input.expiresAt = tokens.expiresAt;
  }

  const result = await credentialStore.store(input);

  return result.match(
    (credentialId) => {
      logger.info({ owner, credentialId }, "GitHub tokens saved successfully");
      return credentialId;
    },
    (error) => {
      logger.error({ err: error, owner }, "Failed to save GitHub tokens");
      throw error;
    },
  );
}
