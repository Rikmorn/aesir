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
 * - LINEAR_ACCESS_TOKEN: Linear API key or OAuth access token
 * - LINEAR_TEAM_ID: Linear team ID for task creation
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude
 * - DATABASE_URL: PostgreSQL connection string (e.g., postgresql://temporal:temporal@localhost:5432/temporal)
 *
 * Usage:
 *   npx tsx src/scripts/start-product-agent.ts
 *
 * Or with npm script:
 *   npm run product-agent
 */

// Early startup logging (before any imports that might fail)
// biome-ignore lint/suspicious/noConsole: Required for early startup debugging
console.log("[product-agent] Starting... (early boot)");
// biome-ignore lint/suspicious/noConsole: Required for early startup debugging
console.log("[product-agent] NODE_ENV:", process.env.NODE_ENV);

// Environment must be loaded FIRST before any other imports
import "@aesir/common";

// Now dynamically import modules that depend on env vars
async function bootstrap(): Promise<void> {
  const { ChatAnthropic } = await import("@langchain/anthropic");
  const { PostgresSaver } = await import(
    "@langchain/langgraph-checkpoint-postgres"
  );
  const { App } = await import("@slack/bolt");
  const { getLinearClient } = await import("@aesir/integrations");
  const { registerHandlers } = await import(
    "../slack/assistant/thread-handlers.js"
  );
  const { createPinoLogger } = await import("@aesir/common");

  const logger = createPinoLogger({
    component: "agents:scripts:product-agent",
  });

  // Note: Required environment variables are validated by ../config/env.js at import time

  // Initialize LLM
  logger.info({}, "Initializing ChatAnthropic");
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
  });

  // Initialize Linear client
  logger.info({}, "Initializing Linear client");
  const linearClient = getLinearClient(process.env.LINEAR_ACCESS_TOKEN!);
  const teamId = process.env.LINEAR_TEAM_ID!;

  // Initialize checkpointer for conversation persistence
  // Uses PostgreSQL for persistence across restarts
  logger.info({}, "Initializing PostgreSQL checkpointer");
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();

  // Create Bolt app with Socket Mode
  // Using App constructor directly for simple Socket Mode setup
  // The @aesir/integration-slack createBoltApp is for production HTTP mode with DB-backed credentials
  logger.info({}, "Creating Bolt app with Socket Mode");
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
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
    linearClient,
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
// biome-ignore lint/suspicious/noConsole: Required for startup error logging
console.log("[product-agent] Calling bootstrap()...");
bootstrap().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: Required for startup error logging
  console.error("[product-agent] Bootstrap failed:", error);
  process.exit(1);
});
