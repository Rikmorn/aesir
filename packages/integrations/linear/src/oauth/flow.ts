/**
 * Linear OAuth Flow Helpers
 *
 * High-level functions for creating LinearClient instances from database credentials.
 *
 * Token refresh is now handled by the refresh middleware:
 * - Proactive: startProactiveRefresh() runs on a timer in main.ts
 * - Reactive: MCP tool handlers wrap calls with withTokenRefresh() for 401 retry
 *
 * This module simply loads credentials and creates a LinearClient.
 */

import { createPinoLogger } from "@aesir/platform";
import type { LinearClient } from "@linear/sdk";
import { createLinearClient, getLinearClient } from "../client/factory.js";
import { DEFAULT_WORKSPACE_ID, loadLinearTokens } from "./token-store.js";

const logger = createPinoLogger({ component: "integrations:linear:oauth" });

/**
 * Create a LinearClient from database credentials
 *
 * Loads OAuth tokens from database and creates a LinearClient with the current
 * access token. Does NOT handle token refresh -- that responsibility belongs to
 * the refresh middleware (proactive timer + reactive 401 retry via withTokenRefresh).
 *
 * @param workspaceId - Workspace ID (defaults to ws_default)
 * @returns LinearClient instance with current access token
 * @throws CredentialNotFoundError if credentials not found in database
 */
export async function createLinearClientFromDatabase(
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<LinearClient> {
  logger.debug({ workspaceId }, "Creating LinearClient from database");

  // Load credentials from database
  const config = await loadLinearTokens(workspaceId);

  // Check if this is an API key (lin_api_*) vs OAuth token
  // API keys don't need Bearer prefix and don't support refresh
  if (config.accessToken.startsWith("lin_api_")) {
    logger.info({ workspaceId }, "Using API key authentication");
    return getLinearClient(config.accessToken);
  }

  // Create client with current access token (no refresh callback needed)
  const client = await createLinearClient(config);
  logger.info({ workspaceId }, "LinearClient created from database");

  return client;
}
