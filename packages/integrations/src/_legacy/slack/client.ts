/**
 * Slack Client Factory
 *
 * Creates WebClient instances with token-based authentication.
 * Provides factory functions for different usage patterns.
 */

import { createPinoLogger } from "@aesir/common";
import { WebClient } from "@slack/web-api";
import type { SlackConfig } from "./types.js";

const logger = createPinoLogger({ component: "integrations:slack" });

/**
 * Create a WebClient with configuration object
 *
 * Use this when you have a SlackConfig object, typically from
 * stored configuration or environment setup.
 *
 * @param config - Slack configuration with bot token
 * @returns Configured WebClient instance
 */
export function createSlackClient(config: SlackConfig): WebClient {
  logger.debug("Creating Slack client with config");

  return new WebClient(config.botToken);
}

/**
 * Create a WebClient directly with a token
 *
 * Use this for testing or when token management is handled externally.
 * Simpler factory when you just have a token string.
 *
 * @param token - Slack bot token (xoxb-...)
 * @returns Configured WebClient instance
 */
export function getSlackClient(token: string): WebClient {
  logger.debug("Creating Slack client with direct token");

  return new WebClient(token);
}
