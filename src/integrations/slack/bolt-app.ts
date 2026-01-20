/**
 * Slack Bolt App Factory
 *
 * Creates and manages Bolt app instances with Socket Mode enabled.
 * Provides lifecycle functions for starting and stopping the app.
 */

import { App } from "@slack/bolt";
import { createLogger } from "../../logging/logger.js";
import type { BoltAppConfig } from "./types.js";

const logger = createLogger({ defaultContext: { module: "slack-bolt-app" } });

/**
 * Create a Bolt app instance configured for Socket Mode
 *
 * Socket Mode enables real-time communication via WebSocket,
 * which is ideal for development and doesn't require a public URL.
 *
 * @param config - Bolt app configuration with tokens
 * @returns Configured Bolt App instance
 *
 * @example
 * ```typescript
 * const app = createBoltApp({
 *   botToken: process.env.SLACK_BOT_TOKEN!,
 *   appToken: process.env.SLACK_APP_TOKEN!,
 *   socketMode: true,
 * });
 * ```
 */
export function createBoltApp(config: BoltAppConfig): App {
  logger.debug("bolt_app_create", {
    message: "Creating Bolt app with Socket Mode",
    context: { socketMode: config.socketMode },
  });

  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: config.socketMode,
  });

  logger.info("bolt_app_created", {
    outcome: "success",
    message: "Bolt app created successfully",
  });

  return app;
}

/**
 * Start the Bolt app
 *
 * Establishes the Socket Mode connection to Slack.
 * The app must be started before it can receive events.
 *
 * @param app - Bolt App instance to start
 * @throws Error if the app fails to start
 *
 * @example
 * ```typescript
 * const app = createBoltApp(config);
 * await startBoltApp(app);
 * console.log('Bot is running!');
 * ```
 */
export async function startBoltApp(app: App): Promise<void> {
  logger.debug("bolt_app_start", {
    message: "Starting Bolt app",
  });

  try {
    await app.start();

    logger.info("bolt_app_started", {
      outcome: "success",
      message: "Bolt app started and connected to Slack",
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("bolt_app_start_failed", {
      outcome: "failure",
      message: `Failed to start Bolt app: ${errorMessage}`,
      context: { error: errorMessage },
    });

    throw error;
  }
}

/**
 * Stop the Bolt app gracefully
 *
 * Closes the Socket Mode connection and cleans up resources.
 * Should be called when shutting down the application.
 *
 * @param app - Bolt App instance to stop
 *
 * @example
 * ```typescript
 * process.on('SIGTERM', async () => {
 *   await stopBoltApp(app);
 *   process.exit(0);
 * });
 * ```
 */
export async function stopBoltApp(app: App): Promise<void> {
  logger.debug("bolt_app_stop", {
    message: "Stopping Bolt app",
  });

  try {
    await app.stop();

    logger.info("bolt_app_stopped", {
      outcome: "success",
      message: "Bolt app stopped gracefully",
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("bolt_app_stop_failed", {
      outcome: "failure",
      message: `Error stopping Bolt app: ${errorMessage}`,
      context: { error: errorMessage },
    });

    // Don't re-throw on stop - we're shutting down anyway
  }
}
