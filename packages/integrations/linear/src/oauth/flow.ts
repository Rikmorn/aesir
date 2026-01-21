/**
 * Linear OAuth Flow Helpers
 *
 * High-level functions for creating LinearClient instances from database credentials.
 * Automatically handles token refresh and persistence.
 */

import { createPinoLogger } from "@aesir/common";
import type { LinearClient } from "@linear/sdk";
import { createLinearClient } from "../client/factory.js";
import type { LinearOAuthConfig } from "../client/types.js";
import { db } from "../db/client.js";
import { createLinearCredentialStore } from "../db/credential-store.js";
import {
  CredentialNotFoundError,
  DEFAULT_WORKSPACE_ID,
  loadLinearTokens,
} from "./token-store.js";

const logger = createPinoLogger({ component: "integrations:linear:oauth" });

/**
 * Create a LinearClient from database credentials
 *
 * Loads OAuth tokens from database, creates LinearClient with automatic
 * token refresh, and persists refreshed tokens back to database.
 *
 * @param workspaceId - Workspace ID (defaults to ws_default)
 * @returns LinearClient instance with valid access token
 * @throws CredentialNotFoundError if credentials not found in database
 */
export async function createLinearClientFromDatabase(
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<LinearClient> {
  logger.debug({ workspaceId }, "Creating LinearClient from database");

  // Load credentials from database
  const config = await loadLinearTokens(workspaceId);

  // Get credential ID for updates
  // biome-ignore lint/suspicious/noExplicitAny: Database type mismatch between node-postgres and postgres-js drivers
  const store = createLinearCredentialStore({ db: db as any, logger });
  const result = await store.getByWorkspace(workspaceId);

  if (result.isErr()) {
    logger.error(
      { err: result.error, workspaceId },
      "Failed to get credential for refresh",
    );
    throw result.error;
  }

  const credential = result.value;
  if (!credential) {
    throw new CredentialNotFoundError(workspaceId);
  }

  // Create callback to persist token refresh
  const onTokenRefresh = async (
    newConfig: LinearOAuthConfig,
  ): Promise<void> => {
    logger.info({ workspaceId }, "Token refreshed, persisting to database");

    // Build update object conditionally for exactOptionalPropertyTypes
    const tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    } = {
      accessToken: newConfig.accessToken,
    };

    if (newConfig.refreshToken !== undefined) {
      tokens.refreshToken = newConfig.refreshToken;
    }

    if (newConfig.expiresAt !== undefined) {
      tokens.expiresAt = new Date(newConfig.expiresAt);
    }

    const updateResult = await store.updateTokens(credential.id, tokens);

    if (updateResult.isErr()) {
      logger.error(
        { err: updateResult.error, workspaceId },
        "Failed to persist refreshed tokens",
      );
      throw updateResult.error;
    }

    logger.info({ workspaceId }, "Refreshed tokens persisted successfully");
  };

  // Create client with refresh persistence
  const client = await createLinearClient(config, onTokenRefresh);
  logger.info({ workspaceId }, "LinearClient created from database");

  return client;
}
