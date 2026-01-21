/**
 * Linear Integration Service Entry Point
 *
 * Starts an Express HTTP server for Linear webhook handling and OAuth flow.
 * Designed to run as an independent containerized service.
 */

import { createHttpLogger, createPinoLogger } from "@aesir/common";
import express from "express";
import { createRoutes } from "./api/routes.js";
import { config } from "./types/config.js";

const logger = createPinoLogger({ component: "integrations:linear" });

async function main() {
  const app = express();

  // Apply raw body middleware for webhook signature verification
  // CRITICAL: This preserves the raw body for HMAC verification
  // Using express.json() would parse the body and break signatures
  app.use(express.raw({ type: "application/json" }));

  // HTTP logging middleware with pino
  app.use(createHttpLogger({ logger }));

  // Mount routes
  const routes = createRoutes({
    logger,
    // Optional: Add onAgentSession handler for webhook processing
    // onAgentSession: async (payload) => {
    //   logger.info({ sessionId: payload.agentSession.id }, "Agent session event");
    // },
  });
  app.use("/", routes);

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "linear-integration" });
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
