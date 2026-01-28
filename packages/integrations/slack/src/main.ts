/**
 * Slack Integration Service Entry Point
 *
 * Starts the Slack integration service in one of two modes:
 * - Socket Mode: WebSocket connection via Bolt (development, firewall-friendly)
 * - HTTP Mode: Traditional HTTP receiver (production, webhook-based)
 *
 * Designed to run as an independent containerized service.
 */

import type { Server } from "node:http";
import { createPinoLogger } from "@aesir/common";
import type { App } from "@slack/bolt";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { createInteractionsRouter } from "./api/interactions.js";
import { createSlackRouter } from "./api/routes.js";
import {
  createBoltApp,
  startBoltApp,
  stopBoltApp,
} from "./client/bolt-factory.js";
import { config } from "./config.js";
import { db, pool } from "./db/client.js";
import { createSlackCredentialStore } from "./db/credential-store.js";
import { createSlackEventDeliveryStore } from "./db/event-delivery-store.js";
import {
  createDispatcher,
  DISPATCH_ROUTES,
  normalizeSlackEvent,
} from "./dispatcher/index.js";
import { normalizeEvent } from "./events/parser.js";

const logger = createPinoLogger({ component: "integrations:slack:server" });

/** Service state for graceful shutdown */
interface ServiceState {
  mode: "socket" | "http";
  boltApp?: App;
  httpServer?: Server;
  expressApp?: Express;
}

let serviceState: ServiceState | null = null;

/**
 * Start the Slack integration service
 *
 * Supports two operational modes:
 * - Socket Mode: Uses Slack Socket Mode via Bolt (requires SLACK_APP_TOKEN)
 * - HTTP Mode: Starts Express server with webhook endpoints
 */
export async function startServer(): Promise<void> {
  const mode = config.server.mode;
  const port = config.server.port;

  logger.info(
    { mode, port, env: config.server.nodeEnv },
    "Starting Slack service",
  );

  // Create database-backed services
  const credentialStore = createSlackCredentialStore({ db, logger });
  const eventDeliveryStore = createSlackEventDeliveryStore({ db, logger });

  // Create dispatcher for event routing to agents (used in both modes)
  const dispatcher = createDispatcher({
    logger: logger.child({ component: "dispatcher" }),
    routes: DISPATCH_ROUTES,
  });

  if (mode === "socket") {
    // === SOCKET MODE ===
    // Uses Slack's Socket Mode for real-time events via WebSocket
    // Ideal for development or when webhooks aren't possible (firewall)
    logger.info("Starting Slack service in Socket Mode");

    // Build options with conditional property assignment for exactOptionalPropertyTypes
    // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
    const boltOptions: any = {
      mode: "socket",
      botToken: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      clientId: config.slack.clientId,
      clientSecret: config.slack.clientSecret,
      port,
    };

    // Add optional fields only if defined
    if (config.slack.appToken !== undefined) {
      boltOptions.appToken = config.slack.appToken;
    }
    if (config.slack.stateSecret !== undefined) {
      boltOptions.stateSecret = config.slack.stateSecret;
    }

    const boltApp = createBoltApp(boltOptions, {
      credentialStore,
      eventDeliveryStore,
      logger,
    });

    // Register event handlers for Socket Mode
    // App mentions
    boltApp.event("app_mention", async ({ event, context }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Bolt context extension
      const log = (context as any).logger ?? logger;
      log.info(
        { channel: event.channel, user: event.user },
        "Received app mention",
      );

      // Guard: app_mention always has user and teamId
      if (!event.user || !context.teamId) {
        log.warn("app_mention missing user or teamId, skipping dispatch");
        return;
      }

      // Normalize Slack event to internal format
      const slackPayload = normalizeEvent({
        type: "app_mention",
        user: event.user,
        channel: event.channel,
        text: event.text,
        ts: event.ts,
        thread_ts: event.thread_ts,
        event_id: context.eventId ?? `evt_${Date.now()}`,
        event_time: Math.floor(Date.now() / 1000),
        team_id: context.teamId,
      });

      // Normalize to dispatch format and dispatch to agents
      const normalizedEvent = normalizeSlackEvent(slackPayload);
      if (normalizedEvent) {
        dispatcher.dispatch(normalizedEvent);
        log.info(
          { eventType: normalizedEvent.type, eventId: normalizedEvent.id },
          "App mention dispatched to agents",
        );
      }
    });

    // Button clicks (approve/reject plan)
    // In Socket Mode, interactive payloads come through Bolt, not HTTP
    // Action IDs: approve_plan_{taskId}_pr (plan approval) or approve_pr (PR approval) or reject_pr
    boltApp.action(
      /^(approve_plan_.+_pr|approve_pr|reject_pr)$/,
      async ({ ack, action, body }) => {
        // Acknowledge immediately (Slack 3-second timeout)
        await ack();

        // biome-ignore lint/suspicious/noExplicitAny: Bolt action type
        const buttonAction = action as any;
        const actionId = buttonAction.action_id as string;
        const value = buttonAction.value as string;
        const boltBody = body as unknown as Record<string, unknown>;
        const userId = (boltBody.user as Record<string, unknown>)?.id as
          | string
          | undefined;
        const userRecord = boltBody.user as Record<string, unknown> | undefined;
        const userName = (userRecord?.name || userRecord?.username) as
          | string
          | undefined;
        const channel = (boltBody.channel as Record<string, unknown>)?.id as
          | string
          | undefined;
        const messageTs = (boltBody.message as Record<string, unknown>)?.ts as
          | string
          | undefined;

        logger.info(
          { actionId, value, userId, channel },
          "Button click received in Socket Mode",
        );

        // Parse action_id to determine intent
        // Format: approve_plan_{taskId}_pr (plan) or approve_pr (PR) or reject_pr
        const isApproval = actionId.startsWith("approve_");
        // Extract taskId from action_id (plan approval) or button value (PR approval)
        const planMatch = actionId.match(/^approve_plan_(.+)_pr$/);
        const taskIdentifier = planMatch?.[1] ?? value;

        // Normalize to event format compatible with dev-agent /events
        const { createId } = await import("@aesir/common");
        const eventId = createId.event();
        const normalizedEvent = {
          id: eventId,
          type: isApproval
            ? "slack.block_actions.approved"
            : "slack.block_actions.rejected",
          source: "slack" as const,
          timestamp: new Date().toISOString(),
          correlationId: eventId,
          payload: {
            taskIdentifier,
            userId,
            userName,
            actionId,
            isApproval,
            messageTs,
            channel,
          },
        };

        // Dispatch to dev-agent (fire-and-forget)
        const devAgentUrl =
          process.env.DEV_AGENT_URL || "http://dev-agent:3004/events";
        try {
          const response = await fetch(devAgentUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(normalizedEvent),
          });
          logger.info(
            { eventId, taskIdentifier, isApproval, status: response.status },
            "Button click dispatched to dev-agent",
          );
        } catch (err) {
          logger.error({ err, eventId }, "Failed to dispatch button click");
        }
      },
    );

    // Escalation button clicks (retry/abort)
    // Action IDs: escalation_retry or escalation_abort (or with prefix like escalation_ON-123_retry)
    boltApp.action(/^.+_(retry|abort)$/, async ({ ack, action, body }) => {
      // Acknowledge immediately (Slack 3-second timeout)
      await ack();

      // biome-ignore lint/suspicious/noExplicitAny: Bolt action type
      const buttonAction = action as any;
      const actionId = buttonAction.action_id as string;
      const value = buttonAction.value as string; // Contains taskId
      // biome-ignore lint/suspicious/noExplicitAny: Bolt body type
      const userId = (body as any).user?.id;
      // biome-ignore lint/suspicious/noExplicitAny: Bolt body type
      const userName = (body as any).user?.name || (body as any).user?.username;
      // biome-ignore lint/suspicious/noExplicitAny: Bolt body type
      const channel = (body as any).channel?.id;
      // biome-ignore lint/suspicious/noExplicitAny: Bolt body type
      const messageTs = (body as any).message?.ts;

      // Determine if this is a retry or abort action
      const isRetry = actionId.endsWith("_retry");
      const escalationAction = isRetry ? "retry" : "abort";

      logger.info(
        { actionId, value, userId, channel, escalationAction },
        "Escalation button click received in Socket Mode",
      );

      // Normalize to event format for escalation resolution
      const { createId } = await import("@aesir/common");
      const eventId = createId.event();
      const normalizedEvent = {
        id: eventId,
        type: `slack.block_actions.escalation_${escalationAction}`,
        source: "slack" as const,
        timestamp: new Date().toISOString(),
        correlationId: eventId,
        payload: {
          taskIdentifier: value, // taskId from button value
          userId,
          userName,
          actionId,
          escalationAction,
          messageTs,
          channel,
        },
      };

      // Dispatch to dev-agent (fire-and-forget)
      const devAgentUrl =
        process.env.DEV_AGENT_URL || "http://dev-agent:3004/events";
      try {
        const response = await fetch(devAgentUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizedEvent),
        });
        logger.info(
          {
            eventId,
            taskIdentifier: value,
            escalationAction,
            status: response.status,
          },
          "Escalation button click dispatched to dev-agent",
        );
      } catch (err) {
        logger.error(
          { err, eventId },
          "Failed to dispatch escalation button click",
        );
      }
    });

    // Messages (thread replies)
    boltApp.event("message", async ({ event, context }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Bolt context extension
      const log = (context as any).logger ?? logger;
      // biome-ignore lint/suspicious/noExplicitAny: Bolt event type union
      const msgEvent = event as any;

      // Skip bot messages to prevent loops
      if (msgEvent.bot_id || msgEvent.subtype === "bot_message") {
        log.debug({ channel: msgEvent.channel }, "Ignoring bot message");
        return;
      }

      log.debug({ channel: msgEvent.channel }, "Received message event");

      // Guard: messages need teamId for routing
      if (!context.teamId) {
        log.warn("message missing teamId, skipping dispatch");
        return;
      }

      // Normalize Slack event to internal format
      const slackPayload = normalizeEvent({
        type: "message",
        user: msgEvent.user,
        channel: msgEvent.channel,
        text: msgEvent.text ?? "",
        ts: msgEvent.ts,
        thread_ts: msgEvent.thread_ts,
        event_id: context.eventId ?? `evt_${Date.now()}`,
        event_time: Math.floor(Date.now() / 1000),
        team_id: context.teamId,
      });

      // Normalize to dispatch format and dispatch to agents
      const normalizedEvent = normalizeSlackEvent(slackPayload);
      if (normalizedEvent) {
        dispatcher.dispatch(normalizedEvent);
        log.debug(
          { eventType: normalizedEvent.type, eventId: normalizedEvent.id },
          "Message dispatched to agents",
        );
      }
    });

    // Start the Bolt app
    await startBoltApp(boltApp);

    // Start HTTP server for health checks, MCP, and interactions in Socket Mode
    // Socket Mode uses WebSocket for Slack events, but we still need HTTP for:
    // - Docker/K8s health checks
    // - MCP tool calls from agents
    // - Slack interactive components (button clicks)
    const healthApp = express();
    healthApp.use(express.json());
    // URL-encoded body parser for Slack interactions (button clicks)
    healthApp.use(express.urlencoded({ extended: true }));

    // Mount interactions router (Slack button clicks)
    // Note: Must be before MCP routes to avoid path conflicts
    const devAgentUrl =
      process.env.DEV_AGENT_URL || "http://dev-agent:3004/events";
    const interactionsRouter = createInteractionsRouter({
      logger: logger.child({ component: "interactions" }),
      dispatchUrl: devAgentUrl,
    });
    healthApp.use("/slack", interactionsRouter);

    // Mount MCP routes (agents call these to send Slack messages)
    const { createMCPRouter } = await import("./api/routes.js");
    const mcpRouter = createMCPRouter({
      db,
      credentialStore,
      logger,
      teamId: "default",
    });
    healthApp.use("/", mcpRouter);

    // Health check endpoint with database validation
    interface HealthResponse {
      status: "ok" | "degraded";
      service: string;
      timestamp: number;
      uptime: number;
      database?: "healthy" | "unhealthy";
      error?: string;
    }

    healthApp.get("/health", async (_req, res) => {
      const health: HealthResponse = {
        status: "ok",
        service: "slack-integration",
        timestamp: Date.now(),
        uptime: process.uptime(),
      };

      try {
        await db.execute(sql`SELECT 1`);
        health.database = "healthy";
      } catch (err) {
        health.status = "degraded";
        health.database = "unhealthy";
        health.error =
          err instanceof Error ? err.message : "Database connection failed";
        logger.error({ err }, "Health check: database unhealthy");
        return res.status(503).json(health);
      }

      return res.status(200).json(health);
    });

    const healthServer = healthApp.listen(port, () => {
      logger.info({ port }, "Health check server started for Socket Mode");
      logger.info(
        { interactivityUrl: "/slack/interactions", devAgentUrl },
        "Slack interactions endpoint configured for HITL approvals",
      );
    });

    serviceState = {
      mode: "socket",
      boltApp,
      httpServer: healthServer,
      expressApp: healthApp,
    };

    logger.info("Slack bot started in Socket Mode");
  } else {
    // === HTTP MODE ===
    // Uses traditional HTTP endpoints for webhooks
    // Ideal for production with proper webhook infrastructure
    logger.info({ port }, "Starting Slack service in HTTP Mode");

    const app = express();

    // JSON body parser for event payloads
    app.use(express.json());
    // URL-encoded body parser for Slack interactions (button clicks)
    app.use(express.urlencoded({ extended: true }));

    // Mount interactions router (Slack button clicks)
    // Must be before other Slack routes for correct path handling
    const devAgentUrl =
      process.env.DEV_AGENT_URL || "http://dev-agent:3004/events";
    const interactionsRouter = createInteractionsRouter({
      logger: logger.child({ component: "interactions" }),
      dispatchUrl: devAgentUrl,
    });
    app.use("/slack", interactionsRouter);

    // Create and mount Slack router
    const router = createSlackRouter({
      db,
      credentialStore,
      eventDeliveryStore,
      logger,
      // Optional: Add event callback for processing
      // onEvent: async (payload) => {
      //   logger.info({ eventType: payload.eventType }, "Event received");
      // },
    });

    app.use("/", router);

    // Mount MCP routes (already have JSON middleware)
    // Import MCP router from routes barrel export
    const { createMCPRouter } = await import("./api/routes.js");
    const mcpRouter = createMCPRouter({
      db,
      credentialStore,
      logger,
      teamId: "default",
    });
    app.use("/", mcpRouter);

    // Start HTTP server
    const server = app.listen(port, () => {
      logger.info(
        { port, env: config.server.nodeEnv },
        "Slack service started in HTTP mode",
      );
      logger.info(
        { interactivityUrl: "/slack/interactions", devAgentUrl },
        "Slack interactions endpoint configured for HITL approvals",
      );
    });

    serviceState = {
      mode: "http",
      httpServer: server,
      expressApp: app,
    };
  }

  // Set up graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    if (!serviceState) {
      logger.warn("No service state found during shutdown");
      process.exit(0);
    }

    try {
      if (serviceState.mode === "socket" && serviceState.boltApp) {
        await stopBoltApp(serviceState.boltApp);
        logger.info("Bolt app stopped");
      }

      // Close HTTP server (used in both modes - HTTP mode or health server in Socket mode)
      if (serviceState.httpServer) {
        await new Promise<void>((resolve, reject) => {
          serviceState?.httpServer?.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info("HTTP server stopped");
      }

      // Close database connection pool
      await pool.end();
      logger.info("Database connection pool closed");

      logger.info("Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Start server if this file is executed directly
startServer().catch((err) => {
  logger.error({ err }, "Failed to start Slack service");
  process.exit(1);
});
