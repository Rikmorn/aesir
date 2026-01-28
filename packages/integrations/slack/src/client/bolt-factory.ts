/**
 * Slack Bolt App Factory
 *
 * Creates Bolt app instances with PostgreSQL-backed installationStore.
 * Supports both Socket Mode (development) and HTTP mode (production).
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import {
  App,
  type Installation,
  type InstallationQuery,
  type InstallationStore,
} from "@slack/bolt";
import type { SlackCredentialStore } from "../db/credential-store.js";
import { SlackError } from "../types/errors.js";
import type { BoltAppDependencies, BoltAppOptions } from "./types.js";

const DEFAULT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:history",
  "im:history",
];

/**
 * Create an InstallationStore adapter that bridges Bolt to PostgreSQL
 *
 * This adapter implements Bolt's InstallationStore interface and uses
 * the SlackCredentialStore for persistence.
 *
 * @param credentialStore - Database-backed credential store
 * @param logger - Logger instance
 * @returns Bolt InstallationStore implementation
 */
export function createInstallationStoreAdapter(
  credentialStore: SlackCredentialStore,
  logger: PinoLogger,
): InstallationStore {
  const log = logger.child({ component: "slack:installation-store" });

  return {
    storeInstallation: async (installation: Installation): Promise<void> => {
      const teamId = installation.team?.id;
      const enterpriseId = installation.enterprise?.id;
      const isEnterpriseInstall = installation.isEnterpriseInstall ?? false;

      log.info(
        { teamId, enterpriseId, isEnterpriseInstall },
        "Storing Slack installation via Bolt",
      );

      if (!teamId && !enterpriseId) {
        throw new SlackError(
          "INT_SLACK_OAUTH",
          "Installation must have team or enterprise ID",
        );
      }

      // Build input with conditional property assignment for exactOptionalPropertyTypes
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const storeInput: any = {
        // biome-ignore lint/style/noNonNullAssertion: Validated above that at least one of teamId or enterpriseId exists
        teamId: teamId ?? enterpriseId!,
        isEnterpriseInstall,
        botToken: installation.bot?.token ?? "",
      };

      if (enterpriseId !== undefined) {
        storeInput.enterpriseId = enterpriseId;
      }
      if (installation.user?.id !== undefined) {
        storeInput.userId = installation.user.id;
      }
      if (installation.user?.token !== undefined) {
        storeInput.userToken = installation.user.token;
      }
      if (installation.bot?.id !== undefined) {
        storeInput.botId = installation.bot.id;
      }
      if (installation.bot?.userId !== undefined) {
        storeInput.botUserId = installation.bot.userId;
      }
      if (installation.bot?.scopes !== undefined) {
        storeInput.botScopes = installation.bot.scopes;
      }
      if (installation.appId !== undefined) {
        storeInput.appId = installation.appId;
      }

      const result = await credentialStore.storeInstallation(storeInput);

      if (result.isErr()) {
        log.error(
          { err: result.error, teamId, enterpriseId },
          "Failed to store installation",
        );
        throw result.error;
      }

      log.info({ teamId, enterpriseId }, "Installation stored successfully");
    },

    fetchInstallation: async (
      query: InstallationQuery<boolean>,
    ): Promise<Installation> => {
      const { teamId, enterpriseId, isEnterpriseInstall } = query;

      log.debug(
        { teamId, enterpriseId, isEnterpriseInstall },
        "Fetching Slack installation via Bolt",
      );

      // Build query with conditional property assignment for exactOptionalPropertyTypes
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const fetchQuery: any = {};
      if (teamId !== undefined) {
        fetchQuery.teamId = teamId;
      }
      if (enterpriseId !== undefined) {
        fetchQuery.enterpriseId = enterpriseId;
      }
      if (isEnterpriseInstall !== undefined) {
        fetchQuery.isEnterpriseInstall = isEnterpriseInstall;
      }

      const result = await credentialStore.fetchInstallation(fetchQuery);

      if (result.isErr()) {
        log.error(
          { err: result.error, teamId },
          "Failed to fetch installation",
        );
        throw result.error;
      }

      const credential = result.value;

      if (!credential) {
        log.debug({ teamId, enterpriseId }, "No installation found");
        throw new SlackError(
          "INT_SLACK_TOKEN",
          `No Slack installation found for query`,
          {
            metadata: { teamId, enterpriseId },
          },
        );
      }

      // Reconstruct Bolt's Installation shape from our credential
      // biome-ignore lint/suspicious/noExplicitAny: Complex Bolt Installation interface with exactOptionalPropertyTypes
      const installation: any = {
        team: { id: credential.teamId },
        isEnterpriseInstall: credential.isEnterpriseInstall,
        tokenType: "bot" as const, // Always bot for our usage
      };

      // Build bot object with conditional properties
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment
      const bot: any = {
        token: credential.botToken,
        scopes: credential.botScopes ?? [],
      };
      if (credential.botId !== null) {
        bot.id = credential.botId;
      }
      if (credential.botUserId !== null) {
        bot.userId = credential.botUserId;
      }
      installation.bot = bot;

      // Build user object with conditional properties
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment
      const user: any = {
        id: credential.userId ?? "unknown",
        scopes: [],
      };
      if (credential.userToken !== null) {
        user.token = credential.userToken;
      }
      installation.user = user;

      // Add optional fields
      if (credential.appId !== null) {
        installation.appId = credential.appId;
      }

      // Add enterprise info if present
      if (credential.enterpriseId !== null) {
        installation.enterprise = { id: credential.enterpriseId };
      }

      return installation as Installation;
    },

    deleteInstallation: async (
      query: InstallationQuery<boolean>,
    ): Promise<void> => {
      const { teamId, enterpriseId, isEnterpriseInstall } = query;

      log.info(
        { teamId, enterpriseId, isEnterpriseInstall },
        "Deleting Slack installation via Bolt",
      );

      // Build query with conditional property assignment for exactOptionalPropertyTypes
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const deleteQuery: any = {};
      if (teamId !== undefined) {
        deleteQuery.teamId = teamId;
      }
      if (enterpriseId !== undefined) {
        deleteQuery.enterpriseId = enterpriseId;
      }
      if (isEnterpriseInstall !== undefined) {
        deleteQuery.isEnterpriseInstall = isEnterpriseInstall;
      }

      const result = await credentialStore.deleteInstallation(deleteQuery);

      if (result.isErr()) {
        log.error(
          { err: result.error, teamId },
          "Failed to delete installation",
        );
        throw result.error;
      }

      log.info({ teamId, enterpriseId }, "Installation deleted");
    },
  };
}

/**
 * Create a Bolt app with PostgreSQL-backed installationStore
 *
 * Supports two modes:
 * - Socket Mode: WebSocket connection (requires appToken)
 * - HTTP Mode: Traditional HTTP receiver (requires signingSecret)
 *
 * @param options - Bolt app configuration
 * @param deps - Dependencies (credential store, logger)
 * @returns Configured Bolt App instance
 */
export function createBoltApp(
  options: BoltAppOptions,
  deps: BoltAppDependencies,
): App {
  const {
    mode,
    botToken,
    appToken,
    signingSecret,
    clientId,
    clientSecret,
    stateSecret,
    scopes,
    port,
  } = options;
  const { credentialStore, logger } = deps;

  const log = logger.child({ component: "integrations:slack:bolt" });

  log.debug({ mode }, "Creating Bolt app");

  // Create installation store adapter
  const installationStore = createInstallationStoreAdapter(
    credentialStore,
    log,
  );

  // Build app options based on mode
  if (mode === "socket") {
    if (!appToken) {
      throw new SlackError(
        "INT_SLACK_TOKEN",
        "appToken is required for Socket Mode. Get it from Slack App Settings > Basic Information > App-Level Tokens.",
      );
    }

    log.info("Creating Bolt app in Socket Mode");

    // Socket Mode configuration
    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      installationStore,
    });

    addLoggingMiddleware(app, log);

    return app;
  }

  // HTTP Mode configuration
  log.info({ port }, "Creating Bolt app in HTTP Mode");

  // Build OAuth options if client credentials provided
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
  const appOptions: any = {
    signingSecret,
    installationStore,
  };

  // Add token if provided (not using OAuth)
  if (botToken) {
    appOptions.token = botToken;
  }

  // Configure OAuth if client credentials provided
  if (clientId && clientSecret) {
    appOptions.clientId = clientId;
    appOptions.clientSecret = clientSecret;
    appOptions.scopes = scopes ?? DEFAULT_SCOPES;

    if (stateSecret) {
      appOptions.stateSecret = stateSecret;
    }

    appOptions.installerOptions = {
      directInstall: true,
    };
  }

  if (port !== undefined) {
    appOptions.port = port;
  }

  const app = new App(appOptions);

  addLoggingMiddleware(app, log);

  return app;
}

/**
 * Add pino logging middleware to Bolt app
 *
 * Creates child loggers with event context for correlation.
 *
 * @param app - Bolt App instance
 * @param logger - Base logger instance
 */
function addLoggingMiddleware(app: App, logger: PinoLogger): void {
  app.use(async ({ payload, context, next }) => {
    // Extract event metadata for correlation
    // biome-ignore lint/suspicious/noExplicitAny: Slack payload types vary
    const p = payload as any;
    const eventId = p.event_id ?? p.trigger_id ?? undefined;
    const userId = p.user ?? p.user_id ?? undefined;
    const eventType = p.type ?? "unknown";

    // Create child logger with event context
    const childLogger = logger.child({ eventId, userId });

    // Attach to context for downstream handlers
    // biome-ignore lint/suspicious/noExplicitAny: Bolt context extension
    (context as any).logger = childLogger;

    childLogger.info({ type: eventType }, "Received Slack event");

    await next();
  });
}

/**
 * Start the Bolt app
 *
 * Establishes connection based on mode (Socket Mode or HTTP).
 * The app must be started before it can receive events.
 *
 * @param app - Bolt App instance to start
 * @throws Error if the app fails to start
 */
export async function startBoltApp(app: App): Promise<void> {
  const logger = createPinoLogger({ component: "integrations:slack:bolt" });

  logger.debug("Starting Bolt app");

  try {
    await app.start();

    logger.info("Bolt app started and connected to Slack");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error({ err: error }, `Failed to start Bolt app: ${errorMessage}`);

    throw error;
  }
}

/**
 * Stop the Bolt app gracefully
 *
 * Closes the connection and cleans up resources.
 * Should be called when shutting down the application.
 *
 * @param app - Bolt App instance to stop
 */
export async function stopBoltApp(app: App): Promise<void> {
  const logger = createPinoLogger({ component: "integrations:slack:bolt" });

  logger.debug("Stopping Bolt app");

  try {
    await app.stop();

    logger.info("Bolt app stopped gracefully");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error({ err: error }, `Error stopping Bolt app: ${errorMessage}`);

    // Don't re-throw on stop - we're shutting down anyway
  }
}
