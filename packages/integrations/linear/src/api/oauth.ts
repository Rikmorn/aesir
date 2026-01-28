/**
 * Linear OAuth Route Handler
 *
 * Handles OAuth 2.0 authorization code flow with:
 * - State parameter for CSRF protection
 * - Authorization redirect to Linear
 * - Callback with code exchange
 * - Token persistence to database
 */

import type { PinoLogger } from "@aesir/platform";
import type { Request, Response } from "express";
import { Router } from "express";
import type { LinearOAuthConfig } from "../client/types.js";
import { config } from "../types/config.js";

export interface OAuthRouterDeps {
  logger: PinoLogger;
}

// In-memory state storage for CSRF protection
// Note: In production, consider Redis for multi-instance deployments
const oauthStates = new Map<string, { created: number }>();

// Cleanup old states (older than 10 minutes)
const STATE_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.created > STATE_TTL_MS) {
      oauthStates.delete(state);
    }
  }
}, 60_000); // Clean up every minute

/**
 * Generate random state parameter for CSRF protection
 */
function generateState(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * Create OAuth router with authorize and callback endpoints
 *
 * @param deps - Dependencies (logger)
 * @returns Express router with /oauth/authorize and /oauth/callback endpoints
 */
export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const { logger } = deps;

  const router = Router();

  /**
   * GET /oauth/authorize
   * Redirects user to Linear's OAuth authorization page
   */
  router.get("/oauth/authorize", (_req: Request, res: Response) => {
    const childLogger = logger.child({ flow: "oauth-authorize" });

    try {
      // Generate and store state
      const state = generateState();
      oauthStates.set(state, { created: Date.now() });

      // Build Linear OAuth URL
      const params = new URLSearchParams({
        client_id: config.linear.clientId,
        redirect_uri:
          config.linear.oauthCallbackUrl ||
          `http://localhost:${config.server.port}/oauth/callback`,
        response_type: "code",
        state,
        scope: "read,write",
        actor: "application",
      });

      const authorizeUrl = `https://linear.app/oauth/authorize?${params.toString()}`;

      childLogger.info({ state }, "Redirecting to Linear OAuth");

      res.redirect(authorizeUrl);
    } catch (error) {
      childLogger.error({ err: error }, "Error initiating OAuth flow");
      res.status(500).send("Failed to initiate OAuth flow");
    }
  });

  /**
   * GET /oauth/callback
   * Handles OAuth callback from Linear, exchanges code for tokens
   */
  router.get("/oauth/callback", async (req: Request, res: Response) => {
    const childLogger = logger.child({ flow: "oauth-callback" });

    try {
      const { code, state, error: oauthError } = req.query;

      // Check for OAuth errors from Linear
      if (oauthError) {
        childLogger.warn({ error: oauthError }, "OAuth error from Linear");
        res.status(400).send(`OAuth error: ${oauthError}`);
        return;
      }

      // Validate required parameters
      if (!code || typeof code !== "string") {
        childLogger.warn("Missing code parameter");
        res.status(400).send("Missing code parameter");
        return;
      }

      if (!state || typeof state !== "string") {
        childLogger.warn("Missing state parameter");
        res.status(400).send("Missing state parameter");
        return;
      }

      // Verify state (CSRF protection)
      const storedState = oauthStates.get(state);
      if (!storedState) {
        childLogger.warn({ state }, "Invalid or expired state parameter");
        res.status(400).send("Invalid or expired state parameter");
        return;
      }

      // Clean up used state
      oauthStates.delete(state);

      childLogger.info("Exchanging authorization code for tokens");

      // Exchange code for tokens
      const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.linear.clientId,
          client_secret: config.linear.clientSecret,
          redirect_uri:
            config.linear.oauthCallbackUrl ||
            `http://localhost:${config.server.port}/oauth/callback`,
          code,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        childLogger.error(
          { status: tokenResponse.status, error: errorText },
          "Failed to exchange code for tokens",
        );
        res.status(500).send("Failed to exchange authorization code");
        return;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        expires_in?: number;
        scope?: string;
        refresh_token?: string;
      };

      // Save tokens to database
      // Import dynamically to avoid circular dependency during parallel execution
      const { saveLinearTokens } = await import("../oauth/token-store.js");

      const oauthConfig: LinearOAuthConfig = {
        accessToken: tokenData.access_token,
        expiresAt: tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : Date.now() + 365 * 24 * 60 * 60 * 1000, // Default to 1 year if not provided
      };

      // Add optional fields if present
      if (tokenData.refresh_token) {
        oauthConfig.refreshToken = tokenData.refresh_token;
      }

      await saveLinearTokens(oauthConfig);

      childLogger.info("Tokens saved successfully");

      // Render success page
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Linear OAuth Success</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 2rem;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
              }
              h1 {
                color: #5E6AD2;
                margin-top: 0;
              }
              p {
                color: #666;
                line-height: 1.5;
              }
              .success {
                color: #22c55e;
                font-size: 3rem;
                margin-bottom: 1rem;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✓</div>
              <h1>Authorization Successful</h1>
              <p>Your Linear workspace has been connected successfully.</p>
              <p>You can now close this window.</p>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      childLogger.error({ err: error }, "Error processing OAuth callback");
      res.status(500).send("Failed to process OAuth callback");
    }
  });

  return router;
}
