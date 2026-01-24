/**
 * GitHub Integration Service Entry Point
 *
 * Starts an Express HTTP server for GitHub webhook handling and OAuth flow.
 * Designed to run as an independent containerized service.
 */

import { createPinoLogger } from "@aesir/common";
import { sql } from "drizzle-orm";
import express from "express";
import { createMCPRouter, createRoutes } from "./api/routes.js";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { createGitHubCredentialStore } from "./db/credential-store.js";
import { createWebhookDeliveryStore } from "./db/webhook-delivery-store.js";

const logger = createPinoLogger({ component: "integrations:github" });

/**
 * Start the GitHub integration HTTP server
 */
export async function startServer(): Promise<void> {
  const app = express();

  // Apply raw body middleware for webhook signature verification
  // CRITICAL: This preserves the raw body for HMAC verification
  // Using express.json() would parse the body and break signatures
  app.use(express.raw({ type: "application/json" }));

  // Create database-backed services
  const credentialStore = createGitHubCredentialStore({ db, logger });
  const deliveryStore = createWebhookDeliveryStore({ db, logger });

  // Mount webhook and OAuth routes
  const routes = createRoutes({
    logger,
    credentialStore,
    deliveryStore,
    clientId: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackUrl:
      config.github.oauthCallbackUrl ||
      `http://localhost:${config.server.port}/oauth/github/callback`,
    // Optional: Add onPRReview handler for webhook processing
    // onPRReview: async (payload, deliveryId) => {
    //   logger.info(
    //     { prNumber: payload.pull_request.number, deliveryId },
    //     "PR review event received",
    //   );
    // },
  });

  app.use("/", routes);

  // Mount MCP routes with JSON middleware
  // MCP routes need parsed JSON body, unlike webhooks which need raw body
  const mcpRouter = createMCPRouter({
    db,
    credentialStore,
    logger,
    owner: "default",
  });
  app.use("/", express.json(), mcpRouter);

  // Health check endpoint with database validation
  interface HealthResponse {
    status: "ok" | "degraded";
    service: string;
    timestamp: number;
    uptime: number;
    database?: "healthy" | "unhealthy";
    error?: string;
  }

  app.get("/health", async (_req, res) => {
    const health: HealthResponse = {
      status: "ok",
      service: "github-integration",
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

  // Start server
  const server = app.listen(config.server.port, () => {
    logger.info(
      {
        port: config.server.port,
        env: config.server.nodeEnv,
      },
      "GitHub integration service started",
    );
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info("SIGTERM received, shutting down gracefully");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Start server if this file is executed directly
startServer().catch((err) => {
  logger.error({ err }, "Failed to start GitHub service");
  process.exit(1);
});
