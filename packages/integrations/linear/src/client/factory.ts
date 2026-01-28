/**
 * Linear Client Factory
 *
 * Creates LinearClient instances with OAuth token management.
 * Handles token refresh when tokens are near expiration.
 */

import { createPinoLogger } from "@aesir/platform";
import { LinearClient } from "@linear/sdk";
import type { LinearOAuthConfig } from "./types.js";

const logger = createPinoLogger({ component: "integrations:linear" });

/**
 * Response from Linear's OAuth token refresh endpoint
 */
interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * Refresh an OAuth token using the refresh token
 *
 * @param refreshToken - The refresh token to use
 * @returns New token data including access token and expiration
 * @throws Error if token refresh fails
 */
export async function refreshOAuthToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set for token refresh",
    );
  }

  logger.info("Refreshing OAuth token");

  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { status: response.status },
      `Token refresh failed: ${response.status} ${errorText}`,
    );
    throw new Error(
      `Failed to refresh Linear OAuth token: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as TokenRefreshResponse;

  logger.info(
    { expiresIn: data.expires_in },
    "OAuth token refreshed successfully",
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Strip "Bearer " prefix from token if present
 *
 * The Linear SDK adds its own "Bearer " prefix, so if the user's token
 * already has one (common copy-paste mistake from cURL commands), we
 * need to strip it to avoid "Bearer Bearer ..." being sent.
 *
 * @param token - Token that may have "Bearer " prefix
 * @returns Clean token without prefix
 */
function stripBearerPrefix(token: string): string {
  return token.replace(/^Bearer\s+/i, "");
}

/**
 * Create a LinearClient with OAuth token management
 *
 * Checks if the token needs refresh (within 60 seconds of expiration)
 * and refreshes it automatically if needed.
 *
 * @param config - OAuth configuration with tokens and expiration
 * @param onTokenRefresh - Optional callback when tokens are refreshed
 * @returns LinearClient instance with valid access token
 */
export async function createLinearClient(
  config: LinearOAuthConfig,
  onTokenRefresh?: (newConfig: LinearOAuthConfig) => Promise<void>,
): Promise<LinearClient> {
  // Check if token needs refresh (within 60 seconds of expiration)
  const now = Date.now();
  const bufferMs = 60_000; // 60 seconds buffer

  if (now >= config.expiresAt - bufferMs) {
    if (!config.refreshToken) {
      // Linear tokens are long-lived (~10 years) and don't include refresh tokens
      // This is expected - just log and continue
      logger.warn(
        { expiresAt: new Date(config.expiresAt).toISOString() },
        "Linear token expiring. Linear doesn't provide refresh tokens - re-run OAuth flow.",
      );
    } else {
      logger.debug(
        {
          expiresAt: new Date(config.expiresAt).toISOString(),
          now: new Date(now).toISOString(),
        },
        "Token expiring soon, refreshing",
      );

      const refreshed = await refreshOAuthToken(config.refreshToken);

      // Update config with new tokens (strip Bearer prefix defensively)
      config.accessToken = stripBearerPrefix(refreshed.accessToken);
      config.refreshToken = refreshed.refreshToken;
      config.expiresAt = now + refreshed.expiresIn * 1000;

      // Notify caller to persist updated config
      if (onTokenRefresh) {
        await onTokenRefresh(config);
      }
    }
  }

  // Strip Bearer prefix from token (common copy-paste mistake)
  return new LinearClient({
    accessToken: stripBearerPrefix(config.accessToken),
  });
}

/**
 * Create a LinearClient directly with a token
 *
 * Automatically detects token type:
 * - API keys (lin_api_...) → uses apiKey option
 * - OAuth tokens → uses accessToken option
 *
 * Use this for testing or when token management is handled externally.
 * Does not handle token refresh.
 *
 * @param token - Valid Linear API key or OAuth access token
 * @returns LinearClient instance
 */
export function getLinearClient(token: string): LinearClient {
  // Strip Bearer prefix if present (common copy-paste mistake)
  const cleanToken = stripBearerPrefix(token);

  // Detect token type: API keys start with "lin_api_"
  // OAuth tokens don't have this prefix
  if (cleanToken.startsWith("lin_api_")) {
    // API key: use apiKey option (no Bearer prefix added)
    return new LinearClient({ apiKey: cleanToken });
  }

  // OAuth token: use accessToken option (Bearer prefix added by SDK)
  return new LinearClient({ accessToken: cleanToken });
}
