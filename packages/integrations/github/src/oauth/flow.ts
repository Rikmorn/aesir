/**
 * GitHub OAuth Flow Helpers
 *
 * High-level functions for creating Octokit clients from database credentials
 * and managing OAuth authorization flow.
 */

import crypto from "node:crypto";
import { createPinoLogger } from "@aesir/common";
import type { Octokit } from "@octokit/rest";
import { createGitHubClient } from "../client/factory.js";
import type { GitHubCredentialStore } from "../db/credential-store.js";
import { GitHubError } from "../types/errors.js";
import { DEFAULT_OWNER, loadGitHubTokens } from "./token-store.js";

const logger = createPinoLogger({ component: "integrations:github:oauth" });

/**
 * Create an Octokit client from database credentials
 *
 * Loads OAuth tokens from database and creates an Octokit client
 * with the access token.
 *
 * @param credentialStore - GitHub credential store instance
 * @param owner - Owner identifier (org or user, defaults to "default")
 * @returns Octokit instance with valid access token
 * @throws GitHubError if credentials not found in database
 */
export async function createGitHubClientFromDatabase(
  credentialStore: GitHubCredentialStore,
  owner = DEFAULT_OWNER,
): Promise<Octokit> {
  logger.debug({ owner }, "Creating Octokit client from database");

  // Load credentials from database
  const tokens = await loadGitHubTokens(credentialStore, owner);

  if (!tokens) {
    logger.error({ owner }, "No GitHub credentials found");
    throw new GitHubError(
      "INT_GITHUB_TOKEN",
      "No credentials found for owner",
      {
        metadata: { owner },
        recovery: {
          isRecoverable: true,
          hint: "Run the OAuth flow to authenticate with GitHub",
        },
      },
    );
  }

  // Create client with access token
  const client = createGitHubClient({ token: tokens.accessToken });
  logger.info({ owner }, "Octokit client created from database");

  return client;
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
 * Build GitHub OAuth authorization URL
 *
 * Constructs the URL to redirect users to for GitHub OAuth authorization.
 * Used in the first step of the OAuth flow.
 *
 * @param options - Authorization URL options
 * @returns GitHub authorization URL
 */
export function buildAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
}): string {
  const { clientId, redirectUri, scope = "repo,read:org", state } = options;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  });

  const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
  logger.debug({ clientId, scope }, "Built GitHub authorization URL");

  return url;
}
