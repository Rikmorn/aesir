/**
 * Linear Client Factory
 *
 * Creates LinearClient instances with OAuth token management.
 * Handles token refresh when tokens are near expiration.
 */

import { type Issue, LinearClient, type WorkflowState } from "@linear/sdk";
import { createLogger } from "../../logging/logger.js";
import type { IssueStatus, LinearConfig } from "./types.js";

const logger = createLogger({ defaultContext: { module: "linear-client" } });

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

  logger.info("linear_token_refresh", {
    message: "Refreshing OAuth token",
  });

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
    logger.error("linear_token_refresh_failed", {
      outcome: "failure",
      message: `Token refresh failed: ${response.status} ${errorText}`,
      context: { status: response.status },
    });
    throw new Error(
      `Failed to refresh Linear OAuth token: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as TokenRefreshResponse;

  logger.info("linear_token_refresh_success", {
    outcome: "success",
    message: "OAuth token refreshed successfully",
    context: { expiresIn: data.expires_in },
  });

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
  config: LinearConfig,
  onTokenRefresh?: (newConfig: LinearConfig) => Promise<void>,
): Promise<LinearClient> {
  // Check if token needs refresh (within 60 seconds of expiration)
  const now = Date.now();
  const bufferMs = 60_000; // 60 seconds buffer

  if (now >= config.expiresAt - bufferMs) {
    if (!config.refreshToken) {
      // Linear tokens are long-lived (~10 years) and don't include refresh tokens
      // This is expected - just log and continue
      logger.warn("linear_token_expiring_no_refresh", {
        message:
          "Linear token expiring. Linear doesn't provide refresh tokens - re-run OAuth flow.",
        context: {
          expiresAt: new Date(config.expiresAt).toISOString(),
        },
      });
    } else {
      logger.debug("linear_token_expiring", {
        message: "Token expiring soon, refreshing",
        context: {
          expiresAt: new Date(config.expiresAt).toISOString(),
          now: new Date(now).toISOString(),
        },
      });

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

/**
 * Read an issue from Linear by ID or identifier
 *
 * @param client - LinearClient instance
 * @param issueId - Issue ID (UUID) or identifier (e.g., "ABC-123")
 * @returns Issue data including title, description, state, and team
 * @throws Error if issue not found
 */
export async function readIssue(
  client: LinearClient,
  issueId: string,
): Promise<Issue> {
  logger.debug("linear_read_issue", {
    message: `Reading issue ${issueId}`,
    context: { issueId },
  });

  const issue = await client.issue(issueId);

  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  return issue;
}

/**
 * Update an issue's status in Linear
 *
 * Finds the workflow state matching the status name for the issue's team
 * and updates the issue with that state.
 *
 * @param client - LinearClient instance
 * @param issueId - Issue ID or identifier
 * @param statusName - Target status name (e.g., "In Progress", "Done")
 * @throws Error if issue not found or status not found for team
 */
export async function updateIssueStatus(
  client: LinearClient,
  issueId: string,
  statusName: IssueStatus,
): Promise<void> {
  logger.debug("linear_update_status", {
    message: `Updating issue ${issueId} to ${statusName}`,
    context: { issueId, statusName },
  });

  // Get the issue to find its team
  const issue = await client.issue(issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  // Get the team's workflow states
  const team = await issue.team;
  if (!team) {
    throw new Error(`Team not found for issue: ${issueId}`);
  }

  const states = await team.states();
  const targetState = states.nodes.find(
    (state: WorkflowState) => state.name === statusName,
  );

  if (!targetState) {
    const availableStates = states.nodes.map((s: WorkflowState) => s.name);
    throw new Error(
      `State "${statusName}" not found for team. Available states: ${availableStates.join(", ")}`,
    );
  }

  // Update the issue with the new state
  await client.updateIssue(issueId, {
    stateId: targetState.id,
  });

  logger.info("linear_status_updated", {
    outcome: "success",
    message: `Issue ${issueId} updated to ${statusName}`,
    context: { issueId, statusName, stateId: targetState.id },
  });
}
