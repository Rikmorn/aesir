/**
 * Dev Agent HTTP Service Entry Point
 *
 * HTTP server for receiving dispatched Linear events and starting workflows.
 * The Temporal worker runs separately in dev-agent-worker container.
 *
 * Required environment variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - DEV_AGENT_SLACK_CHANNEL: Slack channel ID for notifications
 *
 * Optional:
 * - TEMPORAL_ADDRESS: Temporal server (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 * - DEV_AGENT_PORT: HTTP server port (default: 3004)
 *
 * Usage:
 *   node dist/dev-agent/main.js
 */

// Early startup logging (before any imports that might fail)
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[dev-agent] Starting HTTP service... (early boot)");
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[dev-agent] NODE_ENV:", process.env.NODE_ENV);
// biome-ignore lint/suspicious/noConsole: intentional early boot logging before logger is available
console.log("[dev-agent] TEMPORAL_ADDRESS:", process.env.TEMPORAL_ADDRESS);

// Environment must be loaded FIRST before any other imports
import "@aesir/types";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createPinoLogger } from "@aesir/platform";
import { Client, Connection } from "@temporalio/client";
import {
  createDevAgentEventsHandler,
  type DevAgentEventsHandlerDeps,
} from "./api/index.js";

const logger = createPinoLogger({ component: "agents:dev-agent:main" });

async function bootstrap(): Promise<void> {
  // Validate required env vars
  const databaseUrl = process.env.DATABASE_URL;
  const slackChannel = process.env.DEV_AGENT_SLACK_CHANNEL;

  if (!databaseUrl) {
    logger.error({}, "DATABASE_URL is required");
    process.exit(1);
  }
  if (!slackChannel) {
    logger.error({}, "DEV_AGENT_SLACK_CHANNEL is required");
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

  // Create events handler
  // Note: LLM-based comment classification (legacy ChatAnthropic) removed in Phase 35.
  // Linear comment events now route through the smart router (Phase 34) slow path.
  const eventsHandlerDeps: DevAgentEventsHandlerDeps = {
    workflowClient,
    slackChannel,
  };
  const eventsHandler = createDevAgentEventsHandler(eventsHandlerDeps);

  // Log configured event types for HITL flow
  logger.info(
    {
      eventTypes: [
        "linear.agent_session.created",
        "linear.comment.created",
        "slack.block_actions.approved",
        "slack.block_actions.rejected",
        "github.pull_request.merged",
        "github.pull_request.closed",
      ],
    },
    "Dev-agent event handler configured for HITL workflow",
  );

  // Start HTTP server
  const port = parseInt(process.env.DEV_AGENT_PORT ?? "3004", 10);

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Log all incoming requests
      logger.info(
        {
          method: req.method,
          url: req.url,
          contentType: req.headers["content-type"],
          userAgent: req.headers["user-agent"],
        },
        `${req.method} ${req.url}`,
      );

      // Health check endpoint
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "dev-agent" }));
        return;
      }

      // Events endpoint
      if (req.method === "POST" && req.url === "/events") {
        // Collect raw body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");

        // Create adapter for handler
        const handlerReq = {
          headers: req.headers as Record<string, string | undefined>,
          rawBody,
        };

        const handlerRes = {
          status: (code: number) => ({
            json: (body: unknown) => {
              res.writeHead(code, { "Content-Type": "application/json" });
              res.end(JSON.stringify(body));
            },
          }),
        };

        try {
          await eventsHandler(handlerReq, handlerRes);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error(
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
    logger.info({ port }, `Dev agent HTTP server listening on port ${port}`);
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
console.log("[dev-agent] Calling bootstrap()...");
bootstrap().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: intentional error logging at process exit
  console.error("[dev-agent] Bootstrap failed:", error);
  process.exit(1);
});
