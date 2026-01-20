#!/usr/bin/env npx tsx

/**
 * Linear OAuth Authorization Script
 *
 * Performs the OAuth authorization flow to obtain access and refresh tokens
 * for the Linear API. Tokens are persisted to the database via the credential
 * store.
 *
 * Required environment variables:
 * - LINEAR_CLIENT_ID: OAuth application client ID
 * - LINEAR_CLIENT_SECRET: OAuth application client secret
 * - CREDENTIAL_ENCRYPTION_KEY: 32-byte hex key for encrypting tokens
 * - Database connection (DB_HOST, DB_PORT, etc.) for credential storage
 *
 * Usage:
 *   npx tsx src/scripts/linear-oauth.ts
 *
 * Or with npm script:
 *   npm run linear-oauth
 */

// Environment must be loaded FIRST before any other imports
// Note: We import env.ts to use dotenv-flow but this script has additional
// validation for OAuth-specific vars (LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, OAUTH_CALLBACK_URL)
// which are optional in the main schema
import "../config/env.js";

import * as http from "node:http";

const CLIENT_ID = process.env.LINEAR_CLIENT_ID;
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.OAUTH_CALLBACK_URL;

// Scopes required for agent functionality
// Scopes for agent functionality:
// - read,write: Basic API access
// - issues:create,comments:create: Create issues and comments
// - app:assignable: App appears as assignable entity in Linear
// - app:mentionable: App can be @mentioned in comments
const SCOPES =
  "read,write,issues:create,comments:create,app:assignable,app:mentionable";

/**
 * Validate required environment variables
 */
function validateEnv(): void {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    if (!CLIENT_ID) if (!CLIENT_SECRET) if (!REDIRECT_URI) process.exit(1);
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI!,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Linear tokens are long-lived (~10 years) and don't include refresh tokens by design
  const _expiresDate = new Date(Date.now() + data.expires_in * 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Save tokens to database
 */
async function saveTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): Promise<void> {
  const { saveLinearTokens } = await import("@aesir/integrations");
  const credentialId = await saveLinearTokens({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  });
  // biome-ignore lint/suspicious/noConsole: Script output
  console.log(`Tokens saved to database (credential ID: ${credentialId})`);
}

/**
 * Start the OAuth flow
 */
async function main(): Promise<void> {
  validateEnv();

  // Generate state parameter for CSRF protection
  const state = crypto.randomUUID();

  // Build authorization URL
  const authUrl = new URL("https://linear.app/oauth/authorize");
  authUrl.searchParams.set("client_id", CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI!);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("actor", "app"); // CRITICAL: Actions appear as app, not user

  // Create a promise that resolves when we get the callback
  const authPromise = new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:3000`);

      if (url.pathname === "/oauth/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // Handle error from Linear
        if (error) {
          const errorDescription =
            url.searchParams.get("error_description") || error;
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Failed</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>Authorization Failed</h1>
              <p>${errorDescription}</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error(errorDescription));
          return;
        }

        // Verify state parameter (CSRF protection)
        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Failed</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>Invalid State</h1>
              <p>State parameter mismatch. This may be a CSRF attack.</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error("Invalid state parameter"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Failed</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>No Code Received</h1>
              <p>No authorization code was provided.</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        try {
          // Exchange code for tokens
          const tokens = await exchangeCodeForTokens(code);

          // Save tokens to database
          await saveTokens(tokens);

          // Send success response
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>Authorization Successful!</h1>
              <p>Tokens have been saved to database. Check terminal for details.</p>
              <p>You can close this window and return to the terminal.</p>
            </body>
            </html>
          `);

          server.close();
          resolve();
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Token Exchange Failed</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>Token Exchange Failed</h1>
              <p>${errorMessage}</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(3000, "0.0.0.0", () => {});

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error("Authorization timed out after 5 minutes"));
      },
      5 * 60 * 1000,
    );
  });

  try {
    await authPromise;
    process.exit(0);
  } catch (err) {
    const _errorMessage = err instanceof Error ? err.message : "Unknown error";
    process.exit(1);
  }
}

main();
