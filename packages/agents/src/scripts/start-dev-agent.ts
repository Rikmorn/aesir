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

// Environment must be loaded FIRST before any other imports
import "@aesir/common";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { LinearWebhookConfig } from "../api/webhooks/linear-agent-session.js";
import type { ActivityDependencies } from "../temporal/activities/index.js";

async function bootstrap(): Promise<void> {
  const {
    createTemporalWorker,
    DockerSandbox,
    getLinearClient,
    createLinearClientFromFile,
    TokenFileNotFoundError,
  } = await import("@aesir/integrations");
  const { makeActivities } = await import("../temporal/activities/index.js");
  const { linearWebhookHandler } = await import(
    "../api/webhooks/linear-agent-session.js"
  );
  const { prReviewWebhookHandler } = await import(
    "../api/webhooks/github-pr-review.js"
  );
  const { Octokit } = await import("@octokit/rest");
  const { WebClient } = await import("@slack/web-api");
  const { createLogger } = await import("@aesir/common");

  const logger = createLogger({ defaultContext: { module: "dev-agent-main" } });

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
  logger.info("init_dependencies", { message: "Initializing dependencies" });

  // Prefer OAuth tokens from file (shows app identity in Linear)
  // Fall back to LINEAR_ACCESS_TOKEN env var (shows user identity)
  let linearClient;
  try {
    linearClient = await createLinearClientFromFile();
    logger.info("linear_client_init", {
      message: "Using OAuth tokens from .tokens/linear.json (app identity)",
    });
  } catch (err) {
    if (err instanceof TokenFileNotFoundError) {
      logger.warn("linear_client_fallback", {
        message:
          "OAuth tokens not found, falling back to LINEAR_ACCESS_TOKEN (user identity). Run 'docker compose --profile oauth run --rm oauth' for app identity.",
      });
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
  logger.info("init_sandbox", { message: "Creating Docker sandbox" });
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

  logger.info("init_temporal_worker", { message: "Starting Temporal worker" });

  // Create bound activities from dependencies
  const activities = makeActivities(dependencies);

  let worker;
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
    logger.error("temporal_worker_error", {
      outcome: "failure",
      message: `Temporal worker error: ${err.message}`,
    });
    process.exit(1);
  });

  // Start HTTP server for webhooks
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET!;

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Log all incoming requests for debugging
      logger.info("http_request_received", {
        message: `${req.method} ${req.url}`,
        context: {
          method: req.method,
          url: req.url,
          headers: {
            "content-type": req.headers["content-type"],
            "linear-signature": req.headers["linear-signature"]
              ? "[present]"
              : "[missing]",
            "user-agent": req.headers["user-agent"],
          },
        },
      });

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
      };

      // Route to appropriate handler
      if (req.url === "/webhooks/linear") {
        try {
          logger.debug("linear_webhook_routing", {
            message: "Routing to Linear webhook handler",
            context: { bodyLength: rawBody.length },
          });
          await linearWebhookHandler(
            webhookReq,
            webhookRes,
            webhookConfig,
            webhookSecret,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error("linear_webhook_handler_error", {
            outcome: "failure",
            message: `Unhandled error in Linear webhook handler: ${errorMessage}`,
            context: {
              error: errorMessage,
              stack: err instanceof Error ? err.stack : undefined,
            },
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }

      if (req.url === "/webhooks/github") {
        try {
          const body = JSON.parse(rawBody);
          await prReviewWebhookHandler({ ...webhookReq, body }, webhookRes);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
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

  const shutdown = async (_signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // Close HTTP server
    server.close();

    // Shutdown Temporal worker
    worker.shutdown();

    // Cleanup sandbox
    await sandbox.cleanup();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Run bootstrap
bootstrap().catch((_error) => {
  process.exit(1);
});
