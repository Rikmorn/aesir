/**
 * Router HTTP Service Entry Point
 *
 * Single entry point for ALL integration events. Receives normalized events
 * from integration dispatchers and routes them via the smart router.
 *
 * Fast-path events (deterministic match) are processed synchronously (200).
 * Slow-path events (LLM routing) are acknowledged immediately (202 Accepted)
 * and processed asynchronously to prevent dispatcher timeouts.
 *
 * Required environment variables:
 * - ANTHROPIC_API_KEY: API key for LLM slow-path routing
 *
 * Optional:
 * - TEMPORAL_ADDRESS: Temporal server (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 * - ROUTER_PORT: HTTP server port (default: 3006)
 * - ROUTER_ALERTS_CHANNEL: Slack channel ID for ROUT-06 failure alerts
 *
 * Usage:
 *   node dist/router/main.js
 */

// Early startup logging (before any imports that might fail)
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[router] Starting HTTP service... (early boot)");
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[router] NODE_ENV:", process.env.NODE_ENV);
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[router] TEMPORAL_ADDRESS:", process.env.TEMPORAL_ADDRESS);

// Environment must be loaded FIRST before any other imports
import "@aesir/types";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createPinoLogger } from "@aesir/platform";
import { NormalizedEventSchema } from "@aesir/types";
import { Client, Connection } from "@temporalio/client";
import { matchFastPath } from "./fast-path.js";
import { routeEventLegacy } from "./router.js";
import type { RouterDeps } from "./types.js";

const logger = createPinoLogger({ component: "agents:router:main" });

async function bootstrap(): Promise<void> {
  // Validate required env vars
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    logger.error({}, "ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  // Connect to Temporal (for client API - starting/signaling workflows)
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";

  logger.info({ temporalAddress, temporalNamespace }, "Connecting to Temporal");

  const clientConnection = await Connection.connect({
    address: temporalAddress,
  });

  const workflowClient = new Client({
    connection: clientConnection,
    namespace: temporalNamespace,
  });

  logger.info({}, "Connected to Temporal client");

  // Optional alerts channel for ROUT-06 failure alerts
  const alertsChannel = process.env.ROUTER_ALERTS_CHANNEL;
  if (alertsChannel) {
    logger.info({ alertsChannel }, "ROUT-06 alerts channel configured");
  } else {
    logger.warn(
      {},
      "ROUTER_ALERTS_CHANNEL not set - routing failures will be logged but not alerted to Slack",
    );
  }

  // Linear team ID for product-agent workflow starts
  const linearTeamId = process.env.LINEAR_TEAM_ID;
  if (linearTeamId) {
    logger.info(
      { linearTeamId },
      "LINEAR_TEAM_ID configured for product-agent routing",
    );
  } else {
    logger.warn(
      {},
      "LINEAR_TEAM_ID not set - product-agent workflows will start without a Linear team ID",
    );
  }

  // Create router dependencies
  const routerDeps: RouterDeps = {
    workflowClient,
    logger,
    ...(alertsChannel ? { alertsChannel } : {}),
    ...(linearTeamId ? { linearTeamId } : {}),
  };

  // Start HTTP server
  const port = Number.parseInt(process.env.ROUTER_PORT ?? "3006", 10);

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const correlationId = req.headers["x-correlation-id"] as
        | string
        | undefined;

      const requestLogger = correlationId
        ? logger.child({ correlationId })
        : logger;

      // Log all incoming requests
      requestLogger.info(
        {
          method: req.method,
          url: req.url,
          contentType: req.headers["content-type"],
        },
        `${req.method} ${req.url}`,
      );

      // Health check endpoint
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "router" }));
        return;
      }

      // Events endpoint
      if (req.method === "POST" && req.url === "/events") {
        try {
          // Collect raw body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const rawBody = Buffer.concat(chunks).toString("utf8");

          // Parse JSON
          let body: unknown;
          try {
            body = JSON.parse(rawBody);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }

          // Validate with NormalizedEventSchema
          const parsed = NormalizedEventSchema.safeParse(body);
          if (!parsed.success) {
            requestLogger.warn(
              { errors: parsed.error.issues },
              "Event validation failed",
            );
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Event validation failed",
                issues: parsed.error.issues,
              }),
            );
            return;
          }

          const event = parsed.data;

          // Determine routing path: fast (synchronous) or slow (async)
          const fastAction = matchFastPath(event);

          if (fastAction) {
            // Fast path: process synchronously and return result
            const result = await routeEventLegacy(event, routerDeps);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } else {
            // Slow path: acknowledge immediately, process asynchronously
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                received: true,
                eventId: event.id,
                processing: "async",
              }),
            );

            // Process in background (never throw from background task)
            routeEventLegacy(event, routerDeps).catch((err) => {
              requestLogger.error(
                { err, eventId: event.id },
                "Background routing failed",
              );
            });
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          requestLogger.error(
            { err },
            `Unhandled error in events handler: ${errorMessage}`,
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }

      // Not found
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    },
  );

  server.listen(port, () => {
    logger.info({ port }, `Router HTTP server listening on port ${port}`);
  });

  // Graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress, ignoring");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    // 1. Stop accepting new HTTP connections
    logger.info("Closing HTTP server...");
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // 2. Close Temporal client connection
    logger.info("Closing Temporal client connection...");
    await clientConnection.close();
    logger.info("Temporal client connection closed");

    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Force shutdown after 30 seconds if graceful shutdown hangs
  const forceShutdownTimeout = setTimeout(() => {
    if (isShuttingDown) {
      logger.error(
        "Forced shutdown after 30s timeout - graceful shutdown incomplete",
      );
      process.exit(1);
    }
  }, 30_000);
  forceShutdownTimeout.unref(); // Don't keep process alive just for this timer
}

// Run bootstrap
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[router] Calling bootstrap()...");
bootstrap().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: intentional error logging at process exit
  console.error("[router] Bootstrap failed:", error);
  process.exit(1);
});
