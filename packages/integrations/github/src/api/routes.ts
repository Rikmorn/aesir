/**
 * GitHub API Routes Aggregation
 *
 * Combines all API routes (webhook, OAuth) into a single router.
 */

import { createHttpLogger, type PinoLogger } from "@aesir/platform";
import { Router } from "express";
import type { GitHubCredentialStore } from "../db/credential-store.js";
import type { WebhookDeliveryStore } from "../db/webhook-delivery-store.js";
import type { PRReviewPayload } from "../webhooks/parser.js";
import { createOAuthRouter } from "./oauth.js";
import { createWebhookRouter } from "./webhooks.js";

export interface CreateRoutesDeps {
  logger: PinoLogger;
  credentialStore: GitHubCredentialStore;
  deliveryStore: WebhookDeliveryStore;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  onPRReview?: (payload: PRReviewPayload, deliveryId: string) => Promise<void>;
}

/**
 * Create combined routes for GitHub integration
 *
 * Mounts:
 * - Webhook handler at /webhooks/github
 * - OAuth routes at /oauth/github (/authorize, /callback)
 * - Health check at /health
 *
 * @param deps - Dependencies (logger, stores, OAuth config, optional event handlers)
 * @returns Express router with all routes
 */
export function createRoutes(deps: CreateRoutesDeps): Router {
  const {
    logger,
    credentialStore,
    deliveryStore,
    clientId,
    clientSecret,
    callbackUrl,
    onPRReview,
  } = deps;

  const router = Router();

  // HTTP logging middleware with pino
  router.use(createHttpLogger({ logger }));

  // Mount webhook routes at /webhooks/github
  // Build webhook deps conditionally for exactOptionalPropertyTypes
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
  const webhookDeps: any = {
    logger,
    deliveryStore,
  };

  if (onPRReview !== undefined) {
    webhookDeps.onPRReview = onPRReview;
  }

  router.use("/webhooks/github", createWebhookRouter(webhookDeps));

  // Mount OAuth routes at /oauth/github
  router.use(
    "/oauth/github",
    createOAuthRouter({
      logger,
      credentialStore,
      clientId,
      clientSecret,
      callbackUrl,
    }),
  );

  // Health check endpoint
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "github-integration" });
  });

  return router;
}

// Re-export MCP router factory
export type { CreateMCPRouterOptions } from "./mcp.js";
export { createMCPRouter } from "./mcp.js";
