/**
 * Slack OAuth Token Store
 *
 * High-level functions for loading and saving OAuth tokens using Slack's
 * credential store. Provides simple interface for token persistence.
 */

import { createPinoLogger } from "@aesir/platform";
import { db, pool } from "../db/client.js";
import { createSlackCredentialStore } from "../db/credential-store.js";

const logger = createPinoLogger({ component: "integrations:slack:oauth" });

/** Default team ID for single-tenant deployments */
export const DEFAULT_TEAM_ID = "default";

/** Slack OAuth tokens */
export interface SlackTokens {
  botToken: string;
  teamId: string;
  userToken?: string;
  botScopes?: string[];
  enterpriseId?: string;
  botId?: string;
  botUserId?: string;
  appId?: string;
}

/** Input for saving Slack tokens */
export interface SaveSlackTokensInput {
  teamId: string;
  botToken: string;
  userToken?: string;
  botScopes?: string[];
  enterpriseId?: string;
}

/**
 * Load Slack OAuth tokens from database
 *
 * @param options - Optional configuration
 * @param options.teamId - Team ID to load tokens for (defaults to DEFAULT_TEAM_ID)
 * @returns SlackTokens or null if not found
 * @throws SlackError if database operation fails
 */
export async function loadSlackTokens(options?: {
  teamId?: string;
}): Promise<SlackTokens | null> {
  const teamId = options?.teamId ?? DEFAULT_TEAM_ID;

  logger.debug({ teamId }, "Loading Slack tokens from database");

  const credentialStore = createSlackCredentialStore({ db, logger });

  try {
    const result = await credentialStore.fetchInstallation({ teamId });

    return result.match(
      (credential) => {
        if (!credential) {
          logger.debug({ teamId }, "Slack credential not found");
          return null;
        }

        logger.debug({ teamId }, "Slack tokens loaded successfully");

        // Build tokens object with conditional property assignment
        const tokens: SlackTokens = {
          botToken: credential.botToken,
          teamId: credential.teamId,
        };

        if (credential.userToken !== null) {
          tokens.userToken = credential.userToken;
        }
        if (credential.botScopes.length > 0) {
          tokens.botScopes = credential.botScopes;
        }
        if (credential.enterpriseId !== null) {
          tokens.enterpriseId = credential.enterpriseId;
        }
        if (credential.botId !== null) {
          tokens.botId = credential.botId;
        }
        if (credential.botUserId !== null) {
          tokens.botUserId = credential.botUserId;
        }
        if (credential.appId !== null) {
          tokens.appId = credential.appId;
        }

        return tokens;
      },
      (error) => {
        logger.error({ err: error, teamId }, "Failed to load Slack tokens");
        throw error;
      },
    );
  } finally {
    await credentialStore.close();
  }
}

/**
 * Save Slack OAuth tokens to database
 *
 * @param input - Token data to save
 * @returns Credential ID
 * @throws SlackError if database operation fails
 */
export async function saveSlackTokens(
  input: SaveSlackTokensInput,
): Promise<string> {
  const { teamId, botToken } = input;

  logger.info({ teamId }, "Saving Slack tokens to database");

  const credentialStore = createSlackCredentialStore({ db, logger });

  try {
    // Build input with conditional property assignment for exactOptionalPropertyTypes
    // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment workaround for exactOptionalPropertyTypes
    const storeInput: any = {
      teamId,
      botToken,
    };

    if (input.userToken !== undefined) {
      storeInput.userToken = input.userToken;
    }
    if (input.botScopes !== undefined) {
      storeInput.botScopes = input.botScopes;
    }
    if (input.enterpriseId !== undefined) {
      storeInput.enterpriseId = input.enterpriseId;
    }

    const result = await credentialStore.storeInstallation(storeInput);

    return result.match(
      (credentialId) => {
        logger.info(
          { teamId, credentialId },
          "Slack tokens saved successfully",
        );
        return credentialId;
      },
      (error) => {
        logger.error({ err: error, teamId }, "Failed to save Slack tokens");
        throw error;
      },
    );
  } finally {
    await credentialStore.close();
  }
}

/**
 * Close the database pool
 *
 * Call this when shutting down to release connections.
 */
export async function closeSlackTokenStore(): Promise<void> {
  await pool.end();
}
