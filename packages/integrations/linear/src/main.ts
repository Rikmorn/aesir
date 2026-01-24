/**
 * Linear Integration Service Entry Point
 *
 * Starts an Express HTTP server for Linear webhook handling and OAuth flow.
 * Designed to run as an independent containerized service.
 */

import { createHttpLogger, createPinoLogger } from "@aesir/common";
import { sql } from "drizzle-orm";
import express from "express";
import { createMCPRouter, createRoutes } from "./api/routes.js";
import { config } from "./config.js";
import { db } from "./db/client.js";

const logger = createPinoLogger({ component: "integrations:linear" });

async function main() {
  const app = express();

  // Apply raw body middleware for webhook signature verification
  // CRITICAL: This preserves the raw body for HMAC verification
  // Using express.json() would parse the body and break signatures
  app.use(express.raw({ type: "application/json" }));

  // HTTP logging middleware with pino
  app.use(createHttpLogger({ logger }));

  // Mount webhook and OAuth routes
  const routes = createRoutes({
    logger,
    // Optional: Add onAgentSession handler for webhook processing
    // onAgentSession: async (payload) => {
    //   logger.info({ sessionId: payload.agentSession.id }, "Agent session event");
    // },
  });
  app.use("/", routes);

  // Mount MCP routes with JSON middleware
  // MCP routes need parsed JSON body, unlike webhooks which need raw body
  const mcpRouter = createMCPRouter({ db, logger, workspaceId: "ws_default" });
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
      service: "linear-integration",
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
      "Linear integration service started",
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

main().catch((err) => {
  logger.error({ err }, "Failed to start Linear service");
  process.exit(1);
});
