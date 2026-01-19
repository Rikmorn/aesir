#!/usr/bin/env npx tsx
/**
 * Linear OAuth Authorization Script
 *
 * Performs the OAuth authorization flow to obtain access and refresh tokens
 * for the Linear API. Tokens are persisted to .tokens/linear.json for use
 * by the application.
 *
 * Required environment variables:
 * - LINEAR_CLIENT_ID: OAuth application client ID
 * - LINEAR_CLIENT_SECRET: OAuth application client secret
 *
 * Usage:
 *   npx tsx src/scripts/linear-oauth.ts
 *
 * Or with npm script:
 *   npm run linear-oauth
 */

import * as http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const CLIENT_ID = process.env["LINEAR_CLIENT_ID"];
const CLIENT_SECRET = process.env["LINEAR_CLIENT_SECRET"];
const REDIRECT_URI = process.env["OAUTH_CALLBACK_URL"];
const TOKEN_FILE = ".tokens/linear.json";

// Scopes required for agent functionality
const SCOPES = "read,write,issues:create,comments:create";

/**
 * Validate required environment variables
 */
function validateEnv(): void {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error("\n[ERROR] Missing required environment variables:\n");
    if (!CLIENT_ID) console.error("   - LINEAR_CLIENT_ID");
    if (!CLIENT_SECRET) console.error("   - LINEAR_CLIENT_SECRET");
    if (!REDIRECT_URI) console.error("   - OAUTH_CALLBACK_URL");
    console.error(
      "\nCreate a Linear OAuth application at: https://linear.app/settings/api"
    );
    console.error("Set OAUTH_CALLBACK_URL to your Cloudflare tunnel URL for OAuth.");
    console.error("Then add the credentials to .env.local\n");
    process.exit(1);
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
  console.log("\n🔄 Exchanging authorization code for tokens...");

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
  const expiresDate = new Date(Date.now() + data.expires_in * 1000);
  console.log(`   Token valid until: ${expiresDate.toISOString().split("T")[0]} (~${Math.floor(data.expires_in / 86400 / 365)} years)`);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Save tokens to file
 */
async function saveTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): Promise<void> {
  // Ensure directory exists
  await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2) + "\n", {
    mode: 0o600, // Restrictive permissions: owner read/write only
  });
  console.log(`✅ Tokens saved to ${TOKEN_FILE}`);
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
              <h1>❌ Authorization Failed</h1>
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
              <h1>❌ Invalid State</h1>
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
              <h1>❌ No Code Received</h1>
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

          // Save tokens to file
          await saveTokens(tokens);

          // Send success response
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
              <h1>✅ Authorization Successful!</h1>
              <p>Tokens have been saved to <code>${TOKEN_FILE}</code></p>
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
              <h1>❌ Token Exchange Failed</h1>
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

    server.listen(3000, "0.0.0.0", () => {
      console.log("\n[INFO] Linear OAuth Authorization\n");
      console.log("Open this URL in your browser to authorize:\n");
      console.log(`  ${authUrl.toString()}\n`);
      console.log(`Callback URL configured: ${REDIRECT_URI}`);
      console.log("Waiting for authorization callback on port 3000...\n");
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });

  try {
    await authPromise;
    console.log("\n🎉 Authorization complete!\n");
    console.log("You can now use the Linear client with OAuth tokens:");
    console.log(
      "  import { createLinearClientFromFile } from './src/integrations/linear/token-store.js';\n"
    );
    process.exit(0);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`\n❌ Authorization failed: ${errorMessage}\n`);
    process.exit(1);
  }
}

main();
