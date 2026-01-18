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
 *
 * Usage:
 *   npx tsx src/scripts/start-product-agent.ts
 *
 * Or with npm script:
 *   npm run product-agent
 */

import dotenv from "dotenv";

// Load environment variables BEFORE importing modules that use them
// .env.local takes precedence (loaded first), .env provides defaults
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Now dynamically import modules that depend on env vars
async function bootstrap(): Promise<void> {
  const { ChatAnthropic } = await import("@langchain/anthropic");
  const { SqliteSaver } = await import("@langchain/langgraph-checkpoint-sqlite");
  const {
    createBoltApp,
    startBoltApp,
    stopBoltApp,
    registerHandlers,
  } = await import("../integrations/slack/index.js");
  const { getLinearClient } = await import("../integrations/linear/index.js");
  const { createLogger } = await import("../logging/logger.js");

  const logger = createLogger({ defaultContext: { module: "product-agent-main" } });

  /**
   * Validate required environment variables
   */
  function validateEnv(): void {
    const required = [
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
      "LINEAR_ACCESS_TOKEN",
      "LINEAR_TEAM_ID",
      "ANTHROPIC_API_KEY",
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error("\n❌ Missing required environment variables:\n");
      for (const key of missing) {
        console.error(`   - ${key}`);
      }
      console.error("\nSee README.md for setup instructions.\n");
      process.exit(1);
    }
  }

  console.log("\n🤖 Starting Product Agent...\n");

  // Validate environment
  validateEnv();

  // Initialize LLM
  logger.info("init_llm", { message: "Initializing ChatAnthropic" });
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0.7,
  });

  // Initialize Linear client
  logger.info("init_linear", { message: "Initializing Linear client" });
  const linearClient = getLinearClient(process.env["LINEAR_ACCESS_TOKEN"]!);
  const teamId = process.env["LINEAR_TEAM_ID"]!;

  // Initialize checkpointer for conversation persistence
  // Uses in-memory SQLite for development
  logger.info("init_checkpointer", { message: "Initializing SQLite checkpointer" });
  const checkpointer = SqliteSaver.fromConnString(":memory:");

  // Create Bolt app with Socket Mode
  logger.info("init_bolt", { message: "Creating Bolt app with Socket Mode" });
  const app = createBoltApp({
    botToken: process.env["SLACK_BOT_TOKEN"]!,
    appToken: process.env["SLACK_APP_TOKEN"]!,
    socketMode: true,
  });

  // Fetch bot user ID for @mention detection in threads
  // Using auth.test API to dynamically get the bot's user ID
  logger.info("fetch_bot_user_id", { message: "Fetching bot user ID from Slack" });
  let botUserId: string | undefined;
  try {
    const authResult = await app.client.auth.test();
    botUserId = authResult.user_id;
    logger.info("bot_user_id_fetched", {
      outcome: "success",
      message: `Bot user ID: ${botUserId}`,
      context: { botUserId, botName: authResult.user },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.warn("bot_user_id_fetch_failed", {
      message: `Failed to fetch bot user ID: ${errorMessage}. Thread @mention fallback will be disabled.`,
    });
  }

  // Register event handlers
  logger.info("register_handlers", { message: "Registering event handlers" });

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
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n\n📴 Received ${signal}, shutting down gracefully...`);
    await stopBoltApp(app);
    console.log("👋 Goodbye!\n");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the app
  await startBoltApp(app);

  console.log("✅ Product Agent is running!\n");
  console.log("📱 You can now:");
  console.log("   - @mention the bot in a Slack channel");
  console.log("   - Send a direct message to the bot");
  console.log("\n💡 Try: \"I want to build a feature for exporting data as CSV\"\n");
  console.log("Press Ctrl+C to stop.\n");
}

// Run bootstrap
bootstrap().catch((error) => {
  console.error("\n❌ Failed to start Product Agent:", error.message);
  process.exit(1);
});
