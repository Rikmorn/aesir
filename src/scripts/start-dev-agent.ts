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

import dotenv from "dotenv";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ActivityDependencies } from "../temporal/activities/index.js";
import type { LinearWebhookConfig } from "../api/webhooks/linear-agent-session.js";

// Load environment variables BEFORE importing modules that use them
// .env.local takes precedence (loaded first), .env provides defaults
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function bootstrap(): Promise<void> {
  const { createTemporalWorker } = await import("../temporal/worker.js");
  const { makeActivities } = await import("../temporal/activities/index.js");
  const { linearWebhookHandler } = await import(
    "../api/webhooks/linear-agent-session.js"
  );
  const { prReviewWebhookHandler } = await import(
    "../api/webhooks/github-pr-review.js"
  );
  const { getLinearClient } = await import("../integrations/linear/index.js");
  const { Octokit } = await import("@octokit/rest");
  const { WebClient } = await import("@slack/web-api");
  const { DockerSandbox } = await import("../sandbox/docker-sandbox.js");
  const { createLogger } = await import("../logging/logger.js");

  const logger = createLogger({ defaultContext: { module: "dev-agent-main" } });

  /**
   * Validate required environment variables
   */
  function validateEnv(): void {
    const required = [
      "LINEAR_ACCESS_TOKEN",
      "LINEAR_WEBHOOK_SECRET",
      "GITHUB_TOKEN",
      "GITHUB_REPO",
      "SLACK_BOT_TOKEN",
      "SLACK_CHANNEL_ID",
      "ANTHROPIC_API_KEY",
      "DATABASE_URL",
    ];

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      console.error("\nMissing required environment variables:\n");
      for (const key of missing) {
        console.error(`   - ${key}`);
      }
      console.error("\nSee README.md for setup instructions.\n");
      process.exit(1);
    }

    // Validate GITHUB_REPO format
    const repo = process.env["GITHUB_REPO"]!;
    if (!repo.includes("/") || repo.split("/").length !== 2) {
      console.error(
        "\nGITHUB_REPO must be in owner/repo format (e.g., 'acme/my-project')\n"
      );
      process.exit(1);
    }
  }

  console.log("\nStarting Dev Agent...\n");
  validateEnv();

  // Parse GITHUB_REPO (already validated format in validateEnv)
  const [owner, repo] = process.env["GITHUB_REPO"]!.split("/") as [string, string];

  // Initialize dependencies
  logger.info("init_dependencies", { message: "Initializing dependencies" });

  const linearClient = getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!);
  const octokit = new Octokit({ auth: process.env["GITHUB_TOKEN"] });
  const slackClient = new WebClient(process.env["SLACK_BOT_TOKEN"]);

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
    slackChannel: process.env["SLACK_CHANNEL_ID"]!,
    completionStatus: "Done",
  };

  // Start Temporal worker with bound activities
  const temporalAddress = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const temporalNamespace = process.env["TEMPORAL_NAMESPACE"] ?? "default";
  const taskQueue = "dev-agent-queue";

  logger.info("init_temporal_worker", { message: "Starting Temporal worker" });

  let worker;
  try {
    worker = await createTemporalWorker({
      address: temporalAddress,
      namespace: temporalNamespace,
      taskQueue,
      dependencies,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\nFailed to connect to Temporal server.\n");
    console.error(`   Error: ${errorMessage}\n`);
    console.error("Make sure Temporal is running:");
    console.error("   npm run infra:up\n");
    console.error("Then check Temporal UI at http://localhost:8080\n");
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
  const port = parseInt(process.env["PORT"] ?? "3001", 10);
  const webhookSecret = process.env["LINEAR_WEBHOOK_SECRET"]!;

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
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
        await linearWebhookHandler(webhookReq, webhookRes, webhookConfig, webhookSecret);
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
    }
  );

  server.listen(port, () => {
    console.log("\nDev Agent is running!\n");
    console.log("Configuration:");
    console.log(`   Temporal: ${temporalAddress}`);
    console.log(`   Namespace: ${temporalNamespace}`);
    console.log(`   Task Queue: ${taskQueue}`);
    console.log(`   GitHub Repo: ${owner}/${repo}`);
    console.log(`   Webhooks: http://localhost:${port}/webhooks/linear`);
    console.log(`             http://localhost:${port}/webhooks/github`);
    console.log("\nThe Dev Agent processes tasks from Linear:");
    console.log("   1. Configure Linear webhook to POST to /webhooks/linear");
    console.log("   2. Configure GitHub webhook to POST to /webhooks/github");
    console.log("   3. Delegate an issue to the Dev Agent in Linear");
    console.log("   4. The agent will read the issue, generate code, and create a PR");
    console.log("   5. Track progress in Linear's agent activity panel");
    console.log("\nView Temporal UI at http://localhost:8080");
    console.log("\nPress Ctrl+C to stop.\n");
  });

  // Graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n\nReceived ${signal}, shutting down gracefully...`);

    // Close HTTP server
    server.close();

    // Shutdown Temporal worker
    worker.shutdown();

    // Cleanup sandbox
    await sandbox.cleanup();

    console.log("Goodbye!\n");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Run bootstrap
bootstrap().catch((error) => {
  console.error("\nFailed to start Dev Agent:", error.message);
  process.exit(1);
});
