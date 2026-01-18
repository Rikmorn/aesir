#!/usr/bin/env npx tsx
/**
 * Dev Agent Entry Point
 *
 * Starts the Dev Agent Temporal worker that processes development tasks.
 * The worker connects to Temporal server and processes tasks from the
 * 'dev-agent' task queue.
 *
 * Required environment variables:
 * - LINEAR_ACCESS_TOKEN: Linear API key or OAuth access token
 * - GITHUB_TOKEN: GitHub Personal Access Token
 * - GITHUB_REPO: Repository in format 'owner/repo'
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude
 *
 * Optional environment variables:
 * - TEMPORAL_ADDRESS: Temporal server address (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 *
 * Usage:
 *   npx tsx src/scripts/start-dev-agent.ts
 *
 * Or with npm script:
 *   npm run dev-agent
 */

import dotenv from "dotenv";

// Load environment variables BEFORE importing modules that use them
// .env.local takes precedence (loaded first), .env provides defaults
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Now dynamically import modules that depend on env vars
async function bootstrap(): Promise<void> {
  const { createTemporalWorker } = await import("../temporal/worker.js");
  const { createLogger } = await import("../logging/logger.js");

  const logger = createLogger({ defaultContext: { module: "dev-agent-main" } });

  /**
   * Validate required environment variables
   */
  function validateEnv(): void {
    const required = [
      "LINEAR_ACCESS_TOKEN",
      "GITHUB_TOKEN",
      "GITHUB_REPO",
      "ANTHROPIC_API_KEY",
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
    const repo = process.env["GITHUB_REPO"];
    if (repo && !repo.includes("/")) {
      console.error("\nInvalid GITHUB_REPO format.\n");
      console.error("   Expected: owner/repo");
      console.error(`   Got: ${repo}\n`);
      process.exit(1);
    }
  }

  console.log("\nStarting Dev Agent...\n");

  // Validate environment
  validateEnv();

  // Log configuration (without sensitive values)
  const temporalAddress = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const temporalNamespace = process.env["TEMPORAL_NAMESPACE"] ?? "default";
  const taskQueue = "dev-agent";

  logger.info("config", {
    message: "Dev Agent configuration",
    context: {
      temporalAddress,
      temporalNamespace,
      taskQueue,
      githubRepo: process.env["GITHUB_REPO"],
    },
  });

  // Create and start Temporal worker
  logger.info("init_worker", { message: "Initializing Temporal worker" });

  let worker;
  try {
    worker = await createTemporalWorker({
      address: temporalAddress,
      namespace: temporalNamespace,
      taskQueue,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\nFailed to connect to Temporal server.\n");
    console.error(`   Error: ${errorMessage}\n`);
    console.error("Make sure Temporal is running:");
    console.error("   npm run infra:up\n");
    console.error("Then check Temporal UI at http://localhost:8080\n");
    process.exit(1);
  }

  // Handle graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n\nReceived ${signal}, shutting down gracefully...`);
    worker.shutdown();
    console.log("Goodbye!\n");
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the worker (this blocks until shutdown)
  console.log("Dev Agent is running!\n");
  console.log("Configuration:");
  console.log(`   Temporal: ${temporalAddress}`);
  console.log(`   Namespace: ${temporalNamespace}`);
  console.log(`   Task Queue: ${taskQueue}`);
  console.log(`   GitHub Repo: ${process.env["GITHUB_REPO"]}`);
  console.log("\nThe Dev Agent processes tasks from Linear:");
  console.log("   1. Delegate an issue to the Dev Agent in Linear");
  console.log("   2. The agent will read the issue, generate code, and create a PR");
  console.log("   3. Track progress in Linear's agent activity panel");
  console.log("\nView Temporal UI at http://localhost:8080");
  console.log("\nPress Ctrl+C to stop.\n");

  // Run worker - this blocks until shutdown signal
  await worker.run();
}

// Run bootstrap
bootstrap().catch((error) => {
  console.error("\nFailed to start Dev Agent:", error.message);
  process.exit(1);
});
