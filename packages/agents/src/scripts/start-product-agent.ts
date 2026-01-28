#!/usr/bin/env npx tsx
/**
 * Product Agent Entry Point
 *
 * Starts the Product Agent Slack bot with all required dependencies.
 * Uses Socket Mode for local development (no public URL required).
 *
 * Required environment variables:
 * - SLACK_BOT_TOKEN: Bot User OAuth Token (xoxb-...)
 * - SLACK_APP_TOKEN: App-Level Token with connections:write (xapp-...)
 * - LINEAR_TEAM_ID: Linear team ID for task creation
 * - LINEAR_MCP_URL: Linear integration MCP endpoint
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude
 * - DATABASE_URL: PostgreSQL connection string (e.g., postgresql://temporal:temporal@localhost:5432/temporal)
 *
 * Note: Linear operations go through MCP (LINEAR_MCP_URL), not direct SDK.
 *
 * Usage:
 *   npx tsx src/scripts/start-product-agent.ts
 *
 * Or with npm script:
 *   npm run product-agent
 */

// Early startup logging (before any imports that might fail)
console.log("[product-agent] Starting... (early boot)");
console.log("[product-agent] NODE_ENV:", process.env.NODE_ENV);

// Environment must be loaded FIRST before any other imports
import "@aesir/types";

import { createPinoLogger } from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { App } from "@slack/bolt";
import { registerHandlers } from "../slack/assistant/thread-handlers.js";

const logger = createPinoLogger({
  component: "agents:scripts:product-agent",
});

async function bootstrap(): Promise<void> {
  // Validate required env vars
  const teamId = process.env.LINEAR_TEAM_ID;
  const databaseUrl = process.env.DATABASE_URL;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;

  if (!teamId) {
    logger.error({}, "LINEAR_TEAM_ID is required");
    process.exit(1);
  }
  if (!databaseUrl) {
    logger.error({}, "DATABASE_URL is required");
    process.exit(1);
  }
  if (!slackBotToken) {
    logger.error({}, "SLACK_BOT_TOKEN is required");
    process.exit(1);
  }
  if (!slackAppToken) {
    logger.error({}, "SLACK_APP_TOKEN is required");
    process.exit(1);
  }

  // Initialize LLM
  logger.info({}, "Initializing ChatAnthropic");
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
  });

  logger.info({}, "Configuring Linear team ID");

  // Initialize checkpointer for conversation persistence
  // Uses PostgreSQL for persistence across restarts
  logger.info({}, "Initializing PostgreSQL checkpointer");
  const checkpointer = PostgresSaver.fromConnString(databaseUrl);
  await checkpointer.setup();

  // Create Bolt app with Socket Mode
  // Using App constructor directly for simple Socket Mode setup
  logger.info({}, "Creating Bolt app with Socket Mode");
  const app = new App({
    token: slackBotToken,
    appToken: slackAppToken,
    socketMode: true,
  });

  // Fetch bot user ID for @mention detection in threads
  // Using auth.test API to dynamically get the bot's user ID
  logger.info({}, "Fetching bot user ID from Slack");
  let botUserId: string | undefined;
  try {
    const authResult = await app.client.auth.test();
    botUserId = authResult.user_id;
    logger.info(
      { botUserId, botName: authResult.user },
      `Bot user ID: ${botUserId}`,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      { err: error },
      `Failed to fetch bot user ID: ${errorMessage}. Thread @mention fallback will be disabled.`,
    );
  }

  // Register event handlers
  logger.info({}, "Registering event handlers");

  // Build options conditionally for exactOptionalPropertyTypes compliance
  const handlerOptions: Parameters<typeof registerHandlers>[1] = {
    llm,
    teamId,
    checkpointer,
  };
  if (botUserId) {
    handlerOptions.botUserId = botUserId;
  }

  registerHandlers(app, handlerOptions);

  // Handle graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress, ignoring");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    // 1. Stop Bolt app (disconnects from Slack Socket Mode)
    logger.info("Stopping Bolt app...");
    await app.stop();
    logger.info("Bolt app stopped");

    // 2. Close PostgresSaver checkpointer connection
    // Note: PostgresSaver creates its own pg.Pool from the connection string.
    // The pool auto-closes when the process exits, but explicit cleanup is cleaner.
    // If checkpointer exposes a close/end method in future versions, use it here.
    // For now, the pool will be cleaned up by Node.js on exit.
    logger.info("Checkpointer pool will be cleaned up on process exit");

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

  // Start the app
  await app.start();
  logger.info({}, "Bolt app started and connected to Slack");
}

// Run bootstrap
console.log("[product-agent] Calling bootstrap()...");
bootstrap().catch((error) => {
  console.error("[product-agent] Bootstrap failed:", error);
  process.exit(1);
});
