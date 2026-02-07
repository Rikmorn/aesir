/**
 * Linear API Routes Aggregation
 *
 * Combines all API routes (webhook, OAuth) into a single router.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Router } from "express";
import type { AgentSessionPayload } from "../webhooks/types.js";
import { createOAuthRouter } from "./oauth.js";
import { createWebhookRouter } from "./webhooks.js";

export interface CreateRoutesDeps {
  logger: PinoLogger;
  db: NodePgDatabase;
  onAgentSession?: (payload: AgentSessionPayload) => Promise<void>;
}

/**
 * Create combined routes for Linear integration
 *
 * Mounts:
 * - Webhook handler at root (/webhook)
 * - OAuth routes at /oauth (/oauth/authorize, /oauth/callback)
 *
 * @param deps - Dependencies (logger, optional event handlers)
 * @returns Express router with all routes
 */
export function createRoutes(deps: CreateRoutesDeps): Router {
  const { logger, db, onAgentSession } = deps;

  const router = Router();

  // Mount webhook routes (for /webhook)
  // Build webhook deps conditionally for exactOptionalPropertyTypes
  const webhookDeps: {
    logger: PinoLogger;
    db: NodePgDatabase;
    onAgentSession?: (payload: AgentSessionPayload) => Promise<void>;
  } = { logger, db };

  if (onAgentSession !== undefined) {
    webhookDeps.onAgentSession = onAgentSession;
  }

  router.use("/", createWebhookRouter(webhookDeps));

  // Mount OAuth routes (for /oauth/authorize, /oauth/callback)
  router.use("/oauth", createOAuthRouter({ logger }));

  return router;
}

// Re-export MCP router factory
export type { CreateMCPRouterOptions } from "./mcp.js";
export { createMCPRouter } from "./mcp.js";
