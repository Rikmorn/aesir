/**
 * Token Refresh Middleware
 *
 * Dual-layer token refresh for Linear OAuth tokens:
 * 1. Proactive timer -- refreshes before 80% lifetime expiry
 * 2. Reactive 401 retry -- catches edge cases (downtime, clock skew)
 *
 * Both layers coalesce concurrent refresh attempts through a shared mutex.
 */

import type { PinoLogger } from "@aesir/platform";
import { LinearClient } from "@linear/sdk";
import type { LinearCredentialStore } from "../db/credential-store.js";
import { refreshOAuthToken } from "./factory.js";

/** Options for the reactive 401 retry wrapper */
export interface RefreshMiddlewareOptions {
  credentialStore: LinearCredentialStore;
  workspaceId: string;
  logger: PinoLogger;
}

/** Options for the proactive refresh timer */
export interface ProactiveRefreshOptions extends RefreshMiddlewareOptions {
  checkIntervalMs?: number;
}

/** Handle returned by startProactiveRefresh for cleanup */
export interface ProactiveRefreshHandle {
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Module-level mutex for refresh coalescing
// ---------------------------------------------------------------------------

let refreshPromise: Promise<void> | null = null;

/**
 * Detect whether an error is a Linear authentication error (401 / UNAUTHENTICATED).
 *
 * Linear SDK wraps GraphQL errors -- we check several surfaces:
 * - HTTP status 401
 * - GraphQL extension code UNAUTHENTICATED
 * - Error message containing authentication keywords
 */
export function isAuthError(error: unknown): boolean {
  if (error == null) return false;

  // Direct status code check
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;

    // LinearClient throws LinearError with .status
    if (err.status === 401) return true;

    // Check nested response object
    const response = err.response as Record<string, unknown> | undefined;
    if (response?.status === 401) return true;

    // GraphQL extension code
    const extensions = err.extensions as Record<string, unknown> | undefined;
    if (extensions?.code === "UNAUTHENTICATED") return true;
  }

  // Message-based fallback
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (
    message.includes("Unauthorized") ||
    message.includes("Authentication required") ||
    message.includes("UNAUTHENTICATED")
  ) {
    return true;
  }

  return false;
}

/**
 * Detect whether a refresh failure is non-transient (revoked token).
 * Non-transient errors should NOT be retried.
 */
function isNonTransientRefreshError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg.includes("invalid_grant") ||
      msg.includes("400") ||
      msg.includes("401")
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Shared refresh with mutex + retry + alerting
// ---------------------------------------------------------------------------

async function refreshWithMutex(
  options: RefreshMiddlewareOptions,
): Promise<void> {
  // If a refresh is already in progress, coalesce by waiting on it
  if (refreshPromise !== null) {
    return refreshPromise;
  }

  const { credentialStore, workspaceId, logger } = options;

  refreshPromise = (async () => {
    const credential = await credentialStore.getByWorkspace(workspaceId);

    if (credential.isErr()) {
      logger.error(
        { err: credential.error, workspaceId },
        "Failed to load credential for refresh",
      );
      throw credential.error;
    }

    const cred = credential.value;
    if (!cred || !cred.refreshToken) {
      throw new Error(
        `No refresh token available for workspace ${workspaceId}`,
      );
    }

    const delays = [1_000, 2_000, 4_000];
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await refreshOAuthToken(cred.refreshToken);

        // Persist new tokens
        const tokens: {
          accessToken: string;
          refreshToken?: string;
          expiresAt?: Date;
        } = {
          accessToken: result.accessToken,
        };
        if (result.refreshToken !== undefined) {
          tokens.refreshToken = result.refreshToken;
        }
        tokens.expiresAt = new Date(Date.now() + result.expiresIn * 1_000);

        const updateResult = await credentialStore.updateTokens(
          cred.id,
          tokens,
        );
        if (updateResult.isErr()) {
          logger.error(
            { err: updateResult.error, workspaceId },
            "Failed to persist refreshed tokens",
          );
          throw updateResult.error;
        }

        logger.info(
          { workspaceId, expiresIn: result.expiresIn },
          "Token refreshed and persisted successfully",
        );
        return;
      } catch (err) {
        lastError = err;

        // Non-transient: do not retry
        if (isNonTransientRefreshError(err)) {
          logger.error(
            { err, workspaceId },
            "Linear refresh token revoked -- manual re-authorization required",
          );

          // Best-effort Slack alert
          await alertSlackOps(
            `Linear refresh token revoked for workspace ${workspaceId}. Manual re-authorization required.`,
            logger,
          );

          throw err;
        }

        // Transient: retry with backoff
        const delay = delays[attempt];
        if (delay !== undefined && attempt < 2) {
          logger.warn(
            { err, workspaceId, attempt: attempt + 1, nextDelayMs: delay },
            "Token refresh failed (transient), retrying",
          );
          await sleep(delay);
        }
      }
    }

    // All retries exhausted
    logger.error(
      { err: lastError, workspaceId },
      "Token refresh failed after 3 attempts",
    );
    throw lastError;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Reactive 401 retry wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a Linear API operation with automatic 401 retry.
 *
 * Creates a LinearClient from current credentials, executes the operation.
 * On auth error, refreshes the token (coalesced via mutex) and retries once
 * with a fresh client.
 *
 * @param operation - Async function receiving a LinearClient
 * @param options - Credential store, workspace ID, and logger
 * @returns Result of the operation
 */
export async function withTokenRefresh<T>(
  operation: (client: LinearClient) => Promise<T>,
  options: RefreshMiddlewareOptions,
): Promise<T> {
  const { credentialStore, workspaceId, logger } = options;

  const makeClient = async (): Promise<LinearClient> => {
    const result = await credentialStore.getByWorkspace(workspaceId);
    if (result.isErr()) throw result.error;
    const cred = result.value;
    if (!cred)
      throw new Error(`No credential found for workspace ${workspaceId}`);

    // Detect token type: API keys don't need refresh
    if (cred.accessToken.startsWith("lin_api_")) {
      return new LinearClient({ apiKey: cred.accessToken });
    }
    return new LinearClient({ accessToken: cred.accessToken });
  };

  // First attempt
  try {
    const client = await makeClient();
    return await operation(client);
  } catch (error) {
    if (!isAuthError(error)) {
      throw error;
    }

    logger.warn(
      { workspaceId },
      "Auth error detected, refreshing token and retrying",
    );

    // Refresh (coalesced) and retry once
    await refreshWithMutex(options);

    const freshClient = await makeClient();
    return await operation(freshClient);
  }
}

// ---------------------------------------------------------------------------
// Proactive refresh timer
// ---------------------------------------------------------------------------

/**
 * Start a proactive refresh timer that checks token expiry periodically.
 *
 * Refreshes when the token has passed 80% of its lifetime. Checks immediately
 * on first call, then every `checkIntervalMs` (default 60s).
 *
 * @param options - Credential store, workspace ID, logger, and interval
 * @returns Handle with `stop()` method for cleanup on shutdown
 */
export function startProactiveRefresh(
  options: ProactiveRefreshOptions,
): ProactiveRefreshHandle {
  const {
    credentialStore,
    workspaceId,
    logger,
    checkIntervalMs = 60_000,
  } = options;

  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const check = async (): Promise<void> => {
    try {
      const result = await credentialStore.getByWorkspace(workspaceId);
      if (result.isErr()) {
        logger.debug(
          { err: result.error, workspaceId },
          "Proactive refresh: failed to load credential",
        );
        return;
      }

      const cred = result.value;
      if (!cred || !cred.expiresAt || !cred.refreshToken) {
        // No credential, no expiry, or no refresh token -- nothing to do
        return;
      }

      // Calculate 80% lifetime threshold
      const createdAt = cred.createdAt.getTime();
      const expiresAt = cred.expiresAt.getTime();
      const lifetime = expiresAt - createdAt;
      const threshold = createdAt + lifetime * 0.8;

      if (Date.now() >= threshold) {
        logger.info(
          {
            workspaceId,
            expiresAt: cred.expiresAt.toISOString(),
            threshold: new Date(threshold).toISOString(),
          },
          "Proactive refresh: token nearing expiry, refreshing",
        );

        await refreshWithMutex({ credentialStore, workspaceId, logger });
      }
    } catch (err) {
      logger.error({ err, workspaceId }, "Proactive refresh: check failed");
    }
  };

  // Immediate first check
  void check();

  // Schedule periodic checks
  const scheduleNext = (): void => {
    if (stopped) return;
    timerId = setTimeout(() => {
      void check().finally(() => {
        scheduleNext();
      });
    }, checkIntervalMs);
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      logger.info({ workspaceId }, "Proactive token refresh timer stopped");
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort Slack ops channel alert for non-transient token failures.
 * Failures are logged but not propagated -- alerting should never block.
 */
async function alertSlackOps(
  message: string,
  logger: PinoLogger,
): Promise<void> {
  const slackMcpUrl =
    process.env.SLACK_MCP_URL ||
    "http://slack-integration:3003/mcp/tools/send_message";
  const opsChannel = process.env.SLACK_OPS_CHANNEL;

  if (!opsChannel) {
    logger.warn("SLACK_OPS_CHANNEL not set -- skipping ops alert");
    return;
  }

  try {
    const response = await fetch(slackMcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-ID": "linear-integration",
      },
      body: JSON.stringify({
        channel: opsChannel,
        text: message,
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Slack ops alert failed (non-critical)",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Slack ops alert failed (non-critical)");
  }
}
