/**
 * Slack API Routes Aggregation
 *
 * Combines all API routes (events, OAuth) into a single router.
 * Provides health check endpoint and HTTP logging middleware.
 */

import { createHttpLogger, type PinoLogger } from "@aesir/platform";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Router } from "express";
import type { SlackCredentialStore } from "../db/credential-store.js";
import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";
import type { SlackEventPayload } from "../events/types.js";
import { createEventsRouter } from "./events.js";
import { createOAuthRouter } from "./oauth.js";

export interface SlackRouterDeps {
  /** Database connection for health checks */
  db: NodePgDatabase;
  /** Credential store for OAuth installations */
  credentialStore: SlackCredentialStore;
  /** Event delivery store for deduplication */
  eventDeliveryStore: SlackEventDeliveryStore;
  /** Logger instance */
  logger: PinoLogger;
  /** Optional callback for processed events */
  onEvent?: (payload: SlackEventPayload) => Promise<void>;
}

/**
 * Create combined routes for Slack integration
 *
 * Mounts:
 * - Events handler at POST /events (URL verification + event callbacks)
 * - OAuth routes at /oauth/* (authorize, callback, success)
 * - Health check at GET /health
 *
 * @param deps - Dependencies (stores, logger, optional event handler)
 * @returns Express router with all routes
 */
export function createSlackRouter(deps: SlackRouterDeps): Router {
  const { db, credentialStore, eventDeliveryStore, logger, onEvent } = deps;

  const router = Router();

  // HTTP logging middleware with pino
  router.use(createHttpLogger({ logger }));

  // Build events router deps with conditional property for exactOptionalPropertyTypes
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
  const eventsRouterDeps: any = {
    eventDeliveryStore,
    logger,
  };

  if (onEvent !== undefined) {
    eventsRouterDeps.onEvent = onEvent;
  }

  // Mount events router at / (handles POST /events)
  router.use("/", createEventsRouter(eventsRouterDeps));

  // Mount OAuth routes at /oauth/*
  router.use(
    "/oauth",
    createOAuthRouter({
      credentialStore,
      logger,
    }),
  );

  // Health check endpoint with database validation
  interface HealthResponse {
    status: "ok" | "degraded";
    service: string;
    timestamp: number;
    uptime: number;
    database?: "healthy" | "unhealthy";
    error?: string;
  }

  router.get("/health", async (_req, res) => {
    const health: HealthResponse = {
      status: "ok",
      service: "slack-integration",
      timestamp: Date.now(),
      uptime: process.uptime(),
    };

    try {
      await db.execute(sql`SELECT 1`);
      health.database = "healthy";
    } catch (err) {
      health.status = "degraded";
      health.database = "unhealthy";
      health.error =
        err instanceof Error ? err.message : "Database connection failed";
      logger.error({ err }, "Health check: database unhealthy");
      return res.status(503).json(health);
    }

    return res.status(200).json(health);
  });

  return router;
}

// Re-export interactions router factory
export type { InteractionsRouterDeps } from "./interactions.js";
export { createInteractionsRouter } from "./interactions.js";

// Re-export MCP router factory
export type { CreateMCPRouterOptions } from "./mcp.js";
export { createMCPRouter } from "./mcp.js";
