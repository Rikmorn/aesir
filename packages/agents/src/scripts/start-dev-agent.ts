#!/usr/bin/env npx tsx
/**
 * Dev Agent Entry Point
 *
 * Starts the Dev Agent with:
 * 1. Temporal worker for executing workflows
 * 2. HTTP server for Linear webhooks
 *
 * Required environment variables:
 * - LINEAR_WEBHOOK_SECRET: Linear webhook signing secret
 * - GITHUB_WEBHOOK_SECRET: GitHub webhook signing secret
 * - GITHUB_REPO: Repository in owner/repo format
 * - SLACK_CHANNEL_ID: Channel for notifications
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude
 * - DATABASE_URL: PostgreSQL connection string
 * - LINEAR_MCP_URL: Linear integration MCP endpoint
 * - GITHUB_MCP_URL: GitHub integration MCP endpoint
 * - SLACK_MCP_URL: Slack integration MCP endpoint
 *
 * Optional:
 * - TEMPORAL_ADDRESS: Temporal server (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 * - PORT: HTTP server port (default: 3004)
 *
 * Usage:
 *   npx tsx src/scripts/start-dev-agent.ts
 *   npm run dev-agent
 */

// Early startup logging (before any imports that might fail)
console.log("[dev-agent] Starting... (early boot)");
console.log("[dev-agent] NODE_ENV:", process.env.NODE_ENV);
console.log("[dev-agent] TEMPORAL_ADDRESS:", process.env.TEMPORAL_ADDRESS);

// Environment must be loaded FIRST before any other imports
import "@aesir/common";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createPinoLogger } from "@aesir/common";
import { createWebhookIdempotencyService } from "@aesir/integrations/services/webhook-idempotency";
import { createExecutionTracker } from "@aesir/observability";
import { createTemporalWorker, DockerSandbox } from "@aesir/platform";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createEventsHandler } from "../api/events/index.js";
import { prReviewWebhookHandler } from "../api/webhooks/github-pr-review.js";
import {
  type LinearWebhookConfig,
  linearWebhookHandler,
  type WebhookServices,
} from "../api/webhooks/linear-agent-session.js";
import {
  type ActivityDependencies,
  makeActivities,
} from "../temporal/activities/index.js";

const logger = createPinoLogger({ component: "agents:scripts:dev-agent" });

async function bootstrap(): Promise<void> {
  // Create database connection for services
  const connectionString = `postgresql://${process.env.DATABASE_USER ?? "temporal"}:${process.env.DATABASE_PASSWORD ?? "temporal"}@${process.env.DATABASE_HOST ?? "localhost"}:${process.env.DATABASE_PORT ?? "5432"}/${process.env.DATABASE_NAME ?? "temporal"}`;
  const sql = postgres(connectionString);
  const db = drizzle(sql);

  // Create services at startup (not per-request)
  const webhookIdempotency = createWebhookIdempotencyService({
    db,
    logger: logger.child({ service: "webhook-idempotency" }),
  });

  const executionTracker = createExecutionTracker({
    db,
    logger: logger.child({ service: "execution-tracker" }),
  });

  // Note: workspace_id is hardcoded to "ws_default" for single-tenant MVP.
  // Multi-tenant workspace extraction will be implemented when workspace management is added.
  const webhookServices: WebhookServices = {
    webhookIdempotency,
    executionTracker,
    workspaceId: "ws_default",
  };

  // Create events handler for normalized events from integrations
  const eventsHandler = createEventsHandler({
    logger: logger.child({ component: "events" }),
    // Event callbacks will be added in Phase 26 (Dev Agent Workflow)
    // For now, just log and acknowledge
    onLinearEvent: async (event) => {
      logger.info(
        { eventType: event.type, eventId: event.id },
        "Linear event received (handler not yet implemented)",
      );
    },
    onGitHubEvent: async (event) => {
      logger.info(
        { eventType: event.type, eventId: event.id },
        "GitHub event received (handler not yet implemented)",
      );
    },
  });

  /**
   * Validate GITHUB_REPO format (script-specific validation)
   */
  function validateGitHubRepo(): { owner: string; repo: string } {
    const githubRepo = process.env.GITHUB_REPO;
    if (
      !githubRepo ||
      !githubRepo.includes("/") ||
      githubRepo.split("/").length !== 2
    ) {
      logger.error({}, "GITHUB_REPO must be set in owner/repo format");
      process.exit(1);
    }
    const [owner, repo] = githubRepo.split("/") as [string, string];
    return { owner, repo };
  }
  const { owner, repo } = validateGitHubRepo();

  // Create sandbox for worker activities
  // Note: In production, you'd want sandbox-per-task, but for MVP
  // we create one that gets reused by activities
  logger.info({}, "Creating Docker sandbox");
  const sandbox = await DockerSandbox.create({
    image: "node:20-alpine",
  });

  // Activities only need sandbox - all integration calls go through MCP
  const dependencies: ActivityDependencies = {
    sandbox,
  };

  // Validate required env vars
  const slackChannelId = process.env.SLACK_CHANNEL_ID;
  if (!slackChannelId) {
    logger.error({}, "SLACK_CHANNEL_ID is required");
    process.exit(1);
  }

  // Webhook config for Linear events
  const webhookConfig: LinearWebhookConfig = {
    owner,
    repo,
    slackChannel: slackChannelId,
    completionStatus: "Done",
  };

  // Start Temporal worker with bound activities
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = "dev-agent-queue";

  logger.info({}, "Starting Temporal worker");

  // Create bound activities from dependencies
  const activities = makeActivities(dependencies);

  let worker: Awaited<ReturnType<typeof createTemporalWorker>>;
  try {
    worker = await createTemporalWorker({
      address: temporalAddress,
      namespace: temporalNamespace,
      taskQueue,
      activities,
    });
  } catch (error) {
    const _errorMessage =
      error instanceof Error ? error.message : String(error);
    await sandbox.cleanup();
    process.exit(1);
  }

  // Start worker in background (non-blocking)
  const workerPromise = worker.run();
  workerPromise.catch((err) => {
    logger.error({ err }, `Temporal worker error: ${err.message}`);
    process.exit(1);
  });

  // Start HTTP server for webhooks
  const port = parseInt(process.env.PORT ?? "3004", 10);
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error({}, "LINEAR_WEBHOOK_SECRET is required");
    process.exit(1);
  }

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Log all incoming requests for debugging
      logger.info(
        {
          method: req.method,
          url: req.url,
          contentType: req.headers["content-type"],
          hasLinearSignature: Boolean(req.headers["linear-signature"]),
          userAgent: req.headers["user-agent"],
        },
        `${req.method} ${req.url}`,
      );

      // Health check endpoint
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // Only handle POST requests to webhook endpoints
      if (req.method !== "POST") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      // Collect raw body for signature verification
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");

      // Create adapter objects for webhook handlers
      const webhookReq = {
        headers: req.headers as Record<string, string | undefined>,
        rawBody,
      };
      const webhookRes = {
        status: (code: number) => ({
          json: (body: unknown) => {
            res.writeHead(code, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
          },
        }),
        // Add header support for duplicate indication
        setHeader: (name: string, value: string) => {
          res.setHeader(name, value);
        },
      };

      // Normalized events endpoint (from integration dispatchers)
      if (req.url === "/events") {
        try {
          const eventsReq = {
            headers: req.headers as Record<string, string | undefined>,
            rawBody,
          };
          const eventsRes = {
            status: (code: number) => ({
              json: (body: unknown) => {
                res.writeHead(code, { "Content-Type": "application/json" });
                res.end(JSON.stringify(body));
              },
            }),
          };
          await eventsHandler(eventsReq, eventsRes);
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

      // Route to appropriate handler
      if (req.url === "/webhooks/linear") {
        try {
          logger.debug(
            { bodyLength: rawBody.length },
            "Routing to Linear webhook handler",
          );
          await linearWebhookHandler(
            webhookReq,
            webhookRes,
            webhookConfig,
            webhookSecret,
            webhookServices,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error(
            { err },
            `Unhandled error in Linear webhook handler: ${errorMessage}`,
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }

      if (req.url === "/webhooks/github") {
        try {
          // prReviewWebhookHandler now handles JSON parsing and Zod validation
          await prReviewWebhookHandler(webhookReq, webhookRes);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error(
            { err },
            `Unhandled error in GitHub webhook handler: ${errorMessage}`,
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }

      // Unknown endpoint
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

    // 2. Shutdown Temporal worker (completes in-flight tasks)
    logger.info("Shutting down Temporal worker...");
    worker.shutdown();
    logger.info("Temporal worker shutdown initiated");

    // 3. Cleanup Docker sandbox
    logger.info("Cleaning up Docker sandbox...");
    await sandbox.cleanup();
    logger.info("Docker sandbox cleaned up");

    // 4. Close services
    logger.info("Closing webhook idempotency service...");
    await webhookIdempotency.close();
    logger.info("Webhook idempotency service closed");

    logger.info("Closing execution tracker...");
    await executionTracker.close();
    logger.info("Execution tracker closed");

    // 5. Close database connections
    logger.info("Closing database connections...");
    await sql.end({ timeout: 5 });
    logger.info("Database connections closed");

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
console.log("[dev-agent] Calling bootstrap()...");
bootstrap().catch((error) => {
  console.error("[dev-agent] Bootstrap failed:", error);
  process.exit(1);
});
