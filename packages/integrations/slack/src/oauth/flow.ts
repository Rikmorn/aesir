/**
 * Slack OAuth Flow Helpers
 *
 * High-level functions for creating WebClient instances from database credentials
 * and managing OAuth authorization flow.
 */

import crypto from "node:crypto";
import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { WebClient } from "@slack/web-api";
import { createSlackClientFromDatabase as createClientFromDb } from "../client/factory.js";
import type { SlackCredentialStore } from "../db/credential-store.js";

const logger = createPinoLogger({ component: "integrations:slack:oauth" });

/**
 * Options for creating a Slack client from database credentials
 */
export interface CreateSlackClientFromDatabaseOptions {
  /** Slack workspace/team ID */
  teamId: string;
  /** Credential store instance */
  credentialStore: SlackCredentialStore;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * Create a WebClient from database-backed credentials
 *
 * Loads OAuth tokens from database and creates a WebClient
 * with the bot token.
 *
 * @param options - Database and authentication options
 * @returns WebClient instance with valid bot token
 * @throws SlackError if credentials not found in database
 */
export async function createSlackClientFromDatabase(
  options: CreateSlackClientFromDatabaseOptions,
): Promise<WebClient> {
  // Delegate to the factory function with the same signature
  return createClientFromDb(options);
}

/**
 * Generate a cryptographically secure random state string for OAuth CSRF protection
 *
 * @returns 32-byte random hex string (64 characters)
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Default OAuth scopes for Slack bot
 *
 * These scopes support basic agent functionality:
 * - app_mentions:read - Receive @mentions
 * - chat:write - Send messages
 * - channels:history - Read channel messages
 * - im:history - Read direct messages
 * - groups:history - Read private channel messages
 *
 * @returns Array of default bot scopes
 */
export function getDefaultOAuthScopes(): string[] {
  return [
    "app_mentions:read",
    "chat:write",
    "channels:history",
    "im:history",
    "groups:history",
  ];
}

/**
 * Build Slack OAuth authorization URL
 *
 * Constructs the URL to redirect users to for Slack OAuth authorization.
 * Used in the first step of the OAuth flow.
 *
 * @param options - Authorization URL options
 * @returns Slack authorization URL
 */
export function buildAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  state: string;
}): string {
  const {
    clientId,
    redirectUri,
    scopes = getDefaultOAuthScopes(),
    state,
  } = options;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(","),
    state,
  });

  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  logger.debug(
    { clientId, scopes: scopes.join(",") },
    "Built Slack authorization URL",
  );

  return url;
}
