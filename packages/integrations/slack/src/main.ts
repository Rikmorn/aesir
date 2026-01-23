/**
 * Slack Integration Service Entry Point
 *
 * Starts the Slack integration service in one of two modes:
 * - Socket Mode: WebSocket connection via Bolt (development, firewall-friendly)
 * - HTTP Mode: Traditional HTTP receiver (production, webhook-based)
 *
 * Designed to run as an independent containerized service.
 */

import type { Server } from "node:http";
import { createPinoLogger } from "@aesir/common";
import type { App } from "@slack/bolt";
import express, { type Express } from "express";
import { createSlackRouter } from "./api/routes.js";
import {
  createBoltApp,
  startBoltApp,
  stopBoltApp,
} from "./client/bolt-factory.js";
import { db, pool } from "./db/client.js";
import { createSlackCredentialStore } from "./db/credential-store.js";
import { createSlackEventDeliveryStore } from "./db/event-delivery-store.js";
import { config } from "./types/config.js";

const logger = createPinoLogger({ component: "integrations:slack:server" });

/** Service state for graceful shutdown */
interface ServiceState {
  mode: "socket" | "http";
  boltApp?: App;
  httpServer?: Server;
  expressApp?: Express;
}

let serviceState: ServiceState | null = null;

/**
 * Start the Slack integration service
 *
 * Supports two operational modes:
 * - Socket Mode: Uses Slack Socket Mode via Bolt (requires SLACK_APP_TOKEN)
 * - HTTP Mode: Starts Express server with webhook endpoints
 */
export async function startServer(): Promise<void> {
  const mode = config.server.mode;
  const port = config.server.port;

  logger.info(
    { mode, port, env: config.server.nodeEnv },
    "Starting Slack service",
  );

  // Create database-backed services
  const credentialStore = createSlackCredentialStore({ db, logger });
  const eventDeliveryStore = createSlackEventDeliveryStore({ db, logger });

  if (mode === "socket") {
    // === SOCKET MODE ===
    // Uses Slack's Socket Mode for real-time events via WebSocket
    // Ideal for development or when webhooks aren't possible (firewall)
    logger.info("Starting Slack service in Socket Mode");

    // Build options with conditional property assignment for exactOptionalPropertyTypes
    // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
    const boltOptions: any = {
      mode: "socket",
      botToken: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      clientId: config.slack.clientId,
      clientSecret: config.slack.clientSecret,
      port,
    };

    // Add optional fields only if defined
    if (config.slack.appToken !== undefined) {
      boltOptions.appToken = config.slack.appToken;
    }
    if (config.slack.stateSecret !== undefined) {
      boltOptions.stateSecret = config.slack.stateSecret;
    }

    const boltApp = createBoltApp(boltOptions, {
      credentialStore,
      eventDeliveryStore,
      logger,
    });

    // Register event handlers for Socket Mode
    // App mentions
    boltApp.event("app_mention", async ({ event, context }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Bolt context extension
      const log = (context as any).logger ?? logger;
      log.info(
        { channel: event.channel, user: event.user },
        "Received app mention",
      );
      // Add custom handler logic here
    });

    // Messages
    boltApp.event("message", async ({ event, context }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Bolt context extension
      const log = (context as any).logger ?? logger;
      log.debug({ channel: event.channel }, "Received message event");
      // Add custom handler logic here
    });

    // Start the Bolt app
    await startBoltApp(boltApp);

    serviceState = {
      mode: "socket",
      boltApp,
    };

    logger.info("Slack bot started in Socket Mode");
  } else {
    // === HTTP MODE ===
    // Uses traditional HTTP endpoints for webhooks
    // Ideal for production with proper webhook infrastructure
    logger.info({ port }, "Starting Slack service in HTTP Mode");

    const app = express();

    // JSON body parser for event payloads
    app.use(express.json());

    // Create and mount Slack router
    const router = createSlackRouter({
      credentialStore,
      eventDeliveryStore,
      logger,
      // Optional: Add event callback for processing
      // onEvent: async (payload) => {
      //   logger.info({ eventType: payload.eventType }, "Event received");
      // },
    });

    app.use("/", router);

    // Start HTTP server
    const server = app.listen(port, () => {
      logger.info(
        { port, env: config.server.nodeEnv },
        "Slack service started in HTTP mode",
      );
    });

    serviceState = {
      mode: "http",
      httpServer: server,
      expressApp: app,
    };
  }

  // Set up graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    if (!serviceState) {
      logger.warn("No service state found during shutdown");
      process.exit(0);
    }

    try {
      if (serviceState.mode === "socket" && serviceState.boltApp) {
        await stopBoltApp(serviceState.boltApp);
        logger.info("Bolt app stopped");
      }

      if (serviceState.mode === "http" && serviceState.httpServer) {
        await new Promise<void>((resolve, reject) => {
          serviceState?.httpServer?.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info("HTTP server stopped");
      }

      // Close database connection pool
      await pool.end();
      logger.info("Database connection pool closed");

      logger.info("Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Start server if this file is executed directly
startServer().catch((err) => {
  logger.error({ err }, "Failed to start Slack service");
  process.exit(1);
});
