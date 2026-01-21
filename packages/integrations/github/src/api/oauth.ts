/**
 * GitHub OAuth Route Handler
 *
 * Handles OAuth 2.0 authorization code flow with:
 * - State parameter for CSRF protection
 * - Authorization redirect to GitHub
 * - Callback with code exchange
 * - Token persistence to database
 */

import type { PinoLogger } from "@aesir/common";
import type { Request, Response } from "express";
import { Router } from "express";
import type { GitHubCredentialStore } from "../db/credential-store.js";
import { buildAuthorizationUrl, generateOAuthState } from "../oauth/flow.js";
import { saveGitHubTokens } from "../oauth/token-store.js";

export interface OAuthRouterDeps {
  logger: PinoLogger;
  credentialStore: GitHubCredentialStore;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

// In-memory state storage for CSRF protection
// Note: In production, consider Redis for multi-instance deployments
const oauthStates = new Map<string, { created: number; owner?: string }>();

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
 * Create OAuth router with authorize and callback endpoints
 *
 * @param deps - Dependencies (logger, credential store, OAuth config)
 * @returns Express router with /authorize and /callback endpoints
 */
export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const { logger, credentialStore, clientId, clientSecret, callbackUrl } = deps;

  const router = Router();

  /**
   * GET /authorize
   * Redirects user to GitHub's OAuth authorization page
   */
  router.get("/authorize", (req: Request, res: Response) => {
    const childLogger = logger.child({ flow: "oauth-authorize" });

    try {
      // Generate and store state
      const state = generateOAuthState();
      const owner = (req.query.owner as string | undefined) || undefined;

      // Build state storage with conditional property assignment
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const stateData: any = { created: Date.now() };
      if (owner !== undefined) {
        stateData.owner = owner;
      }
      oauthStates.set(state, stateData);

      // Build GitHub OAuth URL
      const authorizeUrl = buildAuthorizationUrl({
        clientId,
        redirectUri: callbackUrl,
        state,
      });

      childLogger.info({ state, owner }, "Redirecting to GitHub OAuth");

      res.redirect(authorizeUrl);
    } catch (error) {
      childLogger.error({ err: error }, "Error initiating OAuth flow");
      res.status(500).send("Failed to initiate OAuth flow");
    }
  });

  /**
   * GET /callback
   * Handles OAuth callback from GitHub, exchanges code for tokens
   */
  router.get("/callback", async (req: Request, res: Response) => {
    const childLogger = logger.child({ flow: "oauth-callback" });

    try {
      const { code, state, error: oauthError } = req.query;

      // Check for OAuth errors from GitHub
      if (oauthError) {
        childLogger.warn({ error: oauthError }, "OAuth error from GitHub");
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

      // Extract owner from state (or default)
      const owner = storedState.owner || "default";

      // Clean up used state
      oauthStates.delete(state);

      childLogger.info({ owner }, "Exchanging authorization code for tokens");

      // Exchange code for tokens
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: callbackUrl,
          }),
        },
      );

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
        scope?: string;
        error?: string;
        error_description?: string;
      };

      // Check for error in response
      if (tokenData.error) {
        childLogger.error(
          { error: tokenData.error, description: tokenData.error_description },
          "GitHub OAuth error",
        );
        res.status(400).send(`OAuth error: ${tokenData.error}`);
        return;
      }

      // Save tokens to database
      // Build tokens object with conditional property assignment
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const tokens: any = {
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type,
      };

      if (tokenData.scope !== undefined) {
        tokens.scope = tokenData.scope;
      }

      await saveGitHubTokens(credentialStore, owner, tokens);

      childLogger.info({ owner }, "Tokens saved successfully");

      // Render success page
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>GitHub OAuth Success</title>
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
                color: #24292e;
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
              <p>Your GitHub account has been connected successfully.</p>
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
