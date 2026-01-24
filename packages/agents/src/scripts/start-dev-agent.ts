#!/usr/bin/env npx tsx
/**
 * Dev Agent Entry Point
 *
 * Starts the Dev Agent with:
 * 1. Temporal worker for executing workflows
 * 2. HTTP server for Linear webhooks
 *
 * Required environment variables:
 * - LINEAR_ACCESS_TOKEN: Linear API key or OAuth access token
 * - LINEAR_WEBHOOK_SECRET: Linear webhook signing secret
 * - GITHUB_TOKEN: GitHub Personal Access Token
 * - GITHUB_REPO: Repository in owner/repo format
 * - SLACK_BOT_TOKEN: Slack bot token for notifications
 * - SLACK_CHANNEL_ID: Channel for notifications
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude
 * - DATABASE_URL: PostgreSQL connection string
 *
 * Optional:
 * - TEMPORAL_ADDRESS: Temporal server (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 * - PORT: HTTP server port (default: 3001)
 *
 * Usage:
 *   npx tsx src/scripts/start-dev-agent.ts
 *   npm run dev-agent
 */

// Early startup logging (before any imports that might fail)
// biome-ignore lint/suspicious/noConsole: Required for early startup debugging
console.log("[dev-agent] Starting... (early boot)");
// biome-ignore lint/suspicious/noConsole: Required for early startup debugging
console.log("[dev-agent] NODE_ENV:", process.env.NODE_ENV);
// biome-ignore lint/suspicious/noConsole: Required for early startup debugging
console.log("[dev-agent] TEMPORAL_ADDRESS:", process.env.TEMPORAL_ADDRESS);

// Environment must be loaded FIRST before any other imports
import "@aesir/common";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  LinearWebhookConfig,
  WebhookServices,
} from "../api/webhooks/linear-agent-session.js";
import type { ActivityDependencies } from "../temporal/activities/index.js";

async function bootstrap(): Promise<void> {
  const {
    createTemporalWorker,
    DockerSandbox,
    getLinearClient,
    createLinearClientFromDatabase,
    CredentialNotFoundError,
    createWebhookIdempotencyService,
  } = await import("@aesir/integrations");
  const { createExecutionTracker } = await import("@aesir/observability");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const { makeActivities } = await import("../temporal/activities/index.js");
  const { linearWebhookHandler } = await import(
    "../api/webhooks/linear-agent-session.js"
  );
  const { prReviewWebhookHandler } = await import(
    "../api/webhooks/github-pr-review.js"
  );
  const { Octokit } = await import("@octokit/rest");
  const { WebClient } = await import("@slack/web-api");
  const { createPinoLogger } = await import("@aesir/common");

  const logger = createPinoLogger({ component: "agents:scripts:dev-agent" });

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

  // Note: Required environment variables are validated by ../config/env.js at import time

  /**
   * Validate GITHUB_REPO format (script-specific validation)
   */
  function validateGitHubRepo(): { owner: string; repo: string } {
    const githubRepo = process.env.GITHUB_REPO!;
    if (!githubRepo.includes("/") || githubRepo.split("/").length !== 2) {
      process.exit(1);
    }
    const [owner, repo] = githubRepo.split("/") as [string, string];
    return { owner, repo };
  }
  const { owner, repo } = validateGitHubRepo();

  // Initialize dependencies
  logger.info({}, "Initializing dependencies");

  // Prefer database credentials (shows app identity in Linear)
  // Fall back to LINEAR_ACCESS_TOKEN env var (shows user identity)
  let linearClient: Awaited<ReturnType<typeof createLinearClientFromDatabase>>;
  try {
    linearClient = await createLinearClientFromDatabase();
    logger.info({}, "Using Linear credentials from database (app identity)");
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      logger.warn(
        {},
        "Linear credentials not found in database, falling back to LINEAR_ACCESS_TOKEN (user identity). Run 'npm run linear-oauth' for app identity.",
      );
      linearClient = getLinearClient(process.env.LINEAR_ACCESS_TOKEN!);
    } else {
      throw err;
    }
  }
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

  // Create sandbox for worker activities
  // Note: In production, you'd want sandbox-per-task, but for MVP
  // we create one that gets reused by activities
  logger.info({}, "Creating Docker sandbox");
  const sandbox = await DockerSandbox.create({
    image: "node:20-alpine",
  });

  const dependencies: ActivityDependencies = {
    linearClient,
    octokit,
    slackClient,
    sandbox,
  };

  // Webhook config for Linear events
  const webhookConfig: LinearWebhookConfig = {
    owner,
    repo,
    slackChannel: process.env.SLACK_CHANNEL_ID!,
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
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET!;

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

  server.listen(port, () => {});

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
// biome-ignore lint/suspicious/noConsole: Required for startup error logging
console.log("[dev-agent] Calling bootstrap()...");
bootstrap().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: Required for startup error logging
  console.error("[dev-agent] Bootstrap failed:", error);
  process.exit(1);
});
