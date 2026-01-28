/**
 * Slack WebClient Factory
 *
 * Creates WebClient instances with token-based authentication.
 * Provides factory functions for different usage patterns.
 */

import type { MCPLogger } from "@aesir/common";
import { createPinoLogger } from "@aesir/platform";
import { WebClient } from "@slack/web-api";
import type { SlackCredentialStore } from "../db/credential-store.js";
import { SlackError } from "../types/errors.js";
import type { SlackClientConfig } from "./types.js";

const logger = createPinoLogger({ component: "integrations:slack:client" });

/**
 * Create a WebClient with configuration object
 *
 * Use this when you have a SlackClientConfig object, typically from
 * stored configuration or environment setup.
 *
 * @param config - Slack configuration with bot token
 * @returns Configured WebClient instance
 */
export function createSlackClient(config: SlackClientConfig): WebClient {
  logger.debug("Creating Slack client with config");

  return new WebClient(config.botToken);
}

/**
 * Create a WebClient directly with a token
 *
 * Use this for testing or when token management is handled externally.
 * Simpler factory when you just have a token string.
 *
 * @param token - Slack bot token (xoxb-...)
 * @returns Configured WebClient instance
 */
export function getSlackClient(token: string): WebClient {
  logger.debug("Creating Slack client with direct token");

  return new WebClient(token);
}

/**
 * Options for creating a Slack client from database credentials
 */
export interface CreateSlackClientFromDatabaseOptions {
  /** Slack workspace/team ID */
  teamId: string;
  /** Credential store instance */
  credentialStore: SlackCredentialStore;
  /** Logger instance */
  logger: MCPLogger;
}

/**
 * Create a WebClient from database-backed credentials
 *
 * Fetches the installation from the credential store and creates
 * a WebClient with the decrypted bot token.
 *
 * @param options - Database and authentication options
 * @returns Configured WebClient instance
 * @throws SlackError if installation not found
 */
export async function createSlackClientFromDatabase(
  options: CreateSlackClientFromDatabaseOptions,
): Promise<WebClient> {
  const { teamId, credentialStore, logger: log } = options;

  log.debug({ teamId }, "Creating Slack client from database credentials");

  // Fetch installation from credential store
  const result = await credentialStore.fetchInstallation({ teamId });

  if (result.isErr()) {
    // Fallback to environment variable for single-workspace development
    const envToken = process.env.SLACK_BOT_TOKEN;
    if (envToken) {
      log.warn(
        { teamId },
        "Database lookup failed, falling back to SLACK_BOT_TOKEN env var",
      );
      return new WebClient(envToken);
    }
    throw result.error;
  }

  const installation = result.value;

  if (!installation) {
    // Fallback to environment variable for single-workspace development
    const envToken = process.env.SLACK_BOT_TOKEN;
    if (envToken) {
      log.warn(
        { teamId },
        "No installation found, falling back to SLACK_BOT_TOKEN env var",
      );
      return new WebClient(envToken);
    }

    log.error({ teamId }, "Slack installation not found");
    throw new SlackError(
      "INT_SLACK_TOKEN",
      `No Slack installation found for team ${teamId}`,
      {
        metadata: { teamId },
      },
    );
  }

  log.info({ teamId }, "Created Slack client from database credentials");

  return new WebClient(installation.botToken);
}
