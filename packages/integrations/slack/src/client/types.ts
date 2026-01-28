/**
 * Slack Client Types
 *
 * Configuration interfaces for WebClient and Bolt app factories.
 */

import type { PinoLogger } from "@aesir/platform";
import type { SlackCredentialStore } from "../db/credential-store.js";
import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";

/**
 * Simple WebClient configuration
 */
export interface SlackClientConfig {
  /** Slack bot token (xoxb-...) */
  botToken: string;
  /** Default channel for posting messages */
  defaultChannel?: string;
}

/**
 * Options for creating a Bolt app
 *
 * Supports two operational modes:
 * - "socket": Uses Socket Mode (WebSocket) - ideal for development
 * - "http": Uses HTTP endpoints - required for production/scale
 */
export interface BoltAppOptions {
  /** Connection mode */
  mode: "socket" | "http";

  /** Bot token (optional if using installationStore for OAuth) */
  botToken?: string;

  /** App-level token for Socket Mode (xapp-...) - required when mode="socket" */
  appToken?: string;

  /** Signing secret for HTTP mode - required when mode="http" */
  signingSecret: string;

  /** OAuth client ID */
  clientId?: string;

  /** OAuth client secret */
  clientSecret?: string;

  /** Secret for OAuth state validation */
  stateSecret?: string;

  /** OAuth scopes to request */
  scopes?: string[];

  /** Port for HTTP mode server */
  port?: number;
}

/**
 * Dependencies for Bolt app creation
 */
export interface BoltAppDependencies {
  /** Credential store for installationStore adapter */
  credentialStore: SlackCredentialStore;
  /** Event delivery store for deduplication */
  eventDeliveryStore: SlackEventDeliveryStore;
  /** Logger instance */
  logger: PinoLogger;
}
