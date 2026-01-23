/**
 * Slack OAuth Route Handler
 *
 * Handles OAuth flow for Slack app installation:
 * - GET /authorize - Redirects to Slack OAuth authorization
 * - GET /callback - Handles OAuth callback and stores installation
 * - GET /success - Success page after installation
 *
 * Uses in-memory state storage for CSRF protection (MVP).
 * For production, consider using Redis for distributed deployments.
 */

import type { PinoLogger } from "@aesir/common";
import type { Request, Response } from "express";
import { Router } from "express";
import type { SlackCredentialStore } from "../db/credential-store.js";
import {
  buildAuthorizationUrl,
  generateOAuthState,
  getDefaultOAuthScopes,
} from "../oauth/flow.js";
import { createSlackInstallationStore } from "../oauth/installation-store.js";
import { config } from "../types/config.js";

export interface OAuthRouterDeps {
  /** Credential store for persisting installations */
  credentialStore: SlackCredentialStore;
  /** Logger instance */
  logger: PinoLogger;
}

/** State entry with creation timestamp */
interface StateEntry {
  createdAt: number;
  redirectUri: string;
}

/** In-memory OAuth state store for CSRF protection */
const oauthStateStore = new Map<string, StateEntry>();

/** State expiry time (10 minutes) */
const STATE_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Clean up expired states from the store
 * Called periodically to prevent memory leaks
 */
function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of oauthStateStore.entries()) {
    if (now - entry.createdAt > STATE_EXPIRY_MS) {
      oauthStateStore.delete(state);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredStates, 5 * 60 * 1000);

/**
 * Create OAuth router for Slack app installation
 *
 * Implements the OAuth 2.0 flow for Slack:
 * 1. GET /authorize - Generate state, redirect to Slack
 * 2. User authorizes on Slack
 * 3. GET /callback - Exchange code for tokens, store installation
 *
 * @param deps - Dependencies (credential store, logger)
 * @returns Express router with OAuth endpoints
 */
export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const { credentialStore, logger } = deps;

  const router = Router();

  // Create installation store adapter
  const installationStore = createSlackInstallationStore({
    credentialStore,
    logger,
  });

  /**
   * GET /authorize
   * Initiates OAuth flow by redirecting to Slack's authorization page
   */
  router.get("/authorize", (_req: Request, res: Response) => {
    const childLogger = logger.child({ endpoint: "oauth:authorize" });

    try {
      // Generate cryptographically secure state for CSRF protection
      const state = generateOAuthState();

      // Determine redirect URI
      const redirectUri =
        config.slack.oauthCallbackUrl ||
        `http://localhost:${config.server.port}/oauth/callback`;

      // Store state with timestamp
      oauthStateStore.set(state, {
        createdAt: Date.now(),
        redirectUri,
      });

      // Build authorization URL
      const authUrl = buildAuthorizationUrl({
        clientId: config.slack.clientId,
        redirectUri,
        scopes: getDefaultOAuthScopes(),
        state,
      });

      childLogger.info("Initiating Slack OAuth flow");

      // Redirect to Slack
      res.redirect(authUrl);
    } catch (error) {
      childLogger.error({ err: error }, "Failed to initiate OAuth flow");
      res.status(500).json({ error: "Failed to initiate OAuth flow" });
    }
  });

  /**
   * GET /callback
   * Handles OAuth callback from Slack after user authorization
   */
  router.get("/callback", async (req: Request, res: Response) => {
    const childLogger = logger.child({ endpoint: "oauth:callback" });

    try {
      const { code, state, error } = req.query;

      // Handle OAuth errors from Slack
      if (error) {
        childLogger.warn({ error }, "OAuth error from Slack");
        res.status(400).send(`
          <html>
            <head><title>Installation Failed</title></head>
            <body>
              <h1>Installation Failed</h1>
              <p>Error: ${error}</p>
              <p><a href="/oauth/authorize">Try again</a></p>
            </body>
          </html>
        `);
        return;
      }

      // Validate required parameters
      if (!code || typeof code !== "string") {
        childLogger.warn("Missing authorization code");
        res.status(400).json({ error: "Missing authorization code" });
        return;
      }

      if (!state || typeof state !== "string") {
        childLogger.warn("Missing state parameter");
        res.status(400).json({ error: "Missing state parameter" });
        return;
      }

      // Validate state for CSRF protection
      const stateEntry = oauthStateStore.get(state);
      if (!stateEntry) {
        childLogger.warn("Invalid or expired state parameter");
        res.status(400).json({ error: "Invalid or expired state parameter" });
        return;
      }

      // Remove state (one-time use)
      oauthStateStore.delete(state);

      // Check if state has expired
      if (Date.now() - stateEntry.createdAt > STATE_EXPIRY_MS) {
        childLogger.warn("State parameter expired");
        res.status(400).json({ error: "State parameter expired" });
        return;
      }

      // Exchange code for tokens via Slack API
      const tokenResponse = await fetch(
        "https://slack.com/api/oauth.v2.access",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: config.slack.clientId,
            client_secret: config.slack.clientSecret,
            code,
            redirect_uri: stateEntry.redirectUri,
          }).toString(),
        },
      );

      // Type the response - Slack OAuth v2 response structure
      interface SlackOAuthResponse {
        ok: boolean;
        error?: string;
        access_token?: string;
        token_type?: string;
        scope?: string;
        bot_user_id?: string;
        app_id?: string;
        team?: { id: string; name?: string };
        enterprise?: { id: string; name?: string } | null;
        is_enterprise_install?: boolean;
        authed_user?: {
          id: string;
          scope?: string;
          access_token?: string;
        };
      }

      const tokenData = (await tokenResponse.json()) as SlackOAuthResponse;

      if (!tokenData.ok) {
        childLogger.error(
          { error: tokenData.error },
          "Failed to exchange code for tokens",
        );
        res.status(400).send(`
          <html>
            <head><title>Installation Failed</title></head>
            <body>
              <h1>Installation Failed</h1>
              <p>Error: ${tokenData.error}</p>
              <p><a href="/oauth/authorize">Try again</a></p>
            </body>
          </html>
        `);
        return;
      }

      // Map token response to Bolt Installation format
      // biome-ignore lint/suspicious/noExplicitAny: Slack OAuth response structure varies
      const installation: any = {
        team: tokenData.team,
        enterprise: tokenData.enterprise,
        user: {
          id: tokenData.authed_user?.id,
          scopes: tokenData.authed_user?.scope?.split(",") ?? [],
          token: tokenData.authed_user?.access_token,
        },
        bot: {
          id: tokenData.bot_user_id,
          userId: tokenData.bot_user_id,
          token: tokenData.access_token,
          scopes: tokenData.scope?.split(",") ?? [],
        },
        appId: tokenData.app_id,
        isEnterpriseInstall: tokenData.is_enterprise_install ?? false,
        tokenType: tokenData.token_type,
      };

      // Store installation via the installation store adapter
      await installationStore.storeInstallation(installation);

      const teamId = tokenData.team?.id ?? tokenData.enterprise?.id;
      childLogger.info({ teamId }, "Slack OAuth flow completed successfully");

      // Redirect to success page
      res.redirect("/oauth/success");
    } catch (error) {
      childLogger.error({ err: error }, "Failed to complete OAuth flow");
      res.status(500).send(`
        <html>
          <head><title>Installation Failed</title></head>
          <body>
            <h1>Installation Failed</h1>
            <p>An unexpected error occurred. Please try again.</p>
            <p><a href="/oauth/authorize">Try again</a></p>
          </body>
        </html>
      `);
    }
  });

  /**
   * GET /success
   * Success page shown after successful installation
   */
  router.get("/success", (_req: Request, res: Response) => {
    res.send(`
      <html>
        <head>
          <title>Installation Complete</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background-color: #f4f4f4;
            }
            .container {
              text-align: center;
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #2EB67D; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Installation Complete!</h1>
            <p>The Slack app has been successfully installed to your workspace.</p>
            <p>You can now close this window and return to Slack.</p>
          </div>
        </body>
      </html>
    `);
  });

  return router;
}
