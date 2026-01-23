/**
 * Slack API Routes Aggregation
 *
 * Combines all API routes (events, OAuth) into a single router.
 * Provides health check endpoint and HTTP logging middleware.
 */

import { createHttpLogger, type PinoLogger } from "@aesir/common";
import { Router } from "express";
import type { SlackCredentialStore } from "../db/credential-store.js";
import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";
import type { SlackEventPayload } from "../events/types.js";
import { createEventsRouter } from "./events.js";
import { createOAuthRouter } from "./oauth.js";

export interface SlackRouterDeps {
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
  const { credentialStore, eventDeliveryStore, logger, onEvent } = deps;

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

  // Health check endpoint
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "slack-integration" });
  });

  return router;
}
