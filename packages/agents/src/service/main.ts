/**
 * Unified Agent Service Entry Point
 *
 * Single Express HTTP server replacing dev-agent:3004, product-agent:3005,
 * and router:3006. Pure wiring -- all business logic lives in the framework
 * module (Phases 37-43).
 *
 * Bootstrap sequence:
 *   1. Env validation (fail-fast via Zod)
 *   2. Logger
 *   3. Database pool + Drizzle ORM
 *   4. AgentRegistry (YAML definitions from disk)
 *   5. ToolRegistry (34 tool factories)
 *   6. EventLog (buffered append-only event recording)
 *   7. SessionProjection (reactive agent_sessions updates)
 *   8. TimeoutScheduler (pg-boss delayed signal delivery)
 *   9. ConversationExecutor (SKIP LOCKED conversation lifecycle)
 *  10. EventRouter (deterministic event-to-agent routing)
 *  11. Express routes (health, events, conversations)
 *  12. Worker loop (poll + execute queued conversations)
 *  13. Graceful shutdown (SIGTERM/SIGINT)
 */

import "../shared/env/config.js";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevContainerManager, createPinoLogger } from "@aesir/platform";
import { NormalizedEventSchema } from "@aesir/types";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import { Pool } from "pg";
import {
  createAgentRegistry,
  createConversationExecutor,
  createEventLog,
  createEventRouter,
  createSessionProjection,
  createTimeoutScheduler,
  createToolRegistry,
  registerAllTools,
} from "../framework/index.js";
import type { ArtifactExtractionConfig } from "../framework/types.js";
import { routeEvent } from "../router/router.js";
import type { RouteEventDeps } from "../router/types.js";
import * as schema from "../shared/db/schema.js";
import { createEmbeddingService } from "../shared/embedding/index.js";
import { config } from "../shared/env/config.js";
import { createDirectoryService } from "../shared/services/directory-service.js";
import { createKnowledgeService } from "../shared/services/knowledge-service.js";
import { createTaskService } from "../shared/services/task-service.js";
import { createApiRouter } from "./api/router.js";

// Resolve definitions directory relative to this file's location.
// In compiled JS (dist/service/main.js), ../../definitions reaches package root.
const DEFINITIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../definitions",
);

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // 1. Logger
  const logger = createPinoLogger({ component: "agent-service" });
  logger.info("Starting agent service");

  // 2. Database pool (explicit, not from shared/db/client.ts singleton)
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected database pool error");
  });

  const db = drizzle(pool, { schema });

  // Untyped Drizzle instance for platform schema ops (DevContainerStore)
  const platformDb = drizzle(pool);

  // 3. AgentRegistry -- loads YAML definitions from disk
  const agentRegistry = createAgentRegistry({
    definitionsDir: DEFINITIONS_DIR,
    logger,
  });

  // 4. ToolRegistry -- 34 tool factories
  const toolRegistry = createToolRegistry({ logger });

  // 4b. TaskService -- task lifecycle operations (Phase 58.2)
  const taskService = createTaskService({ db, logger });

  // 4c. EmbeddingService -- provider-agnostic vector embedding
  const embeddingService = createEmbeddingService({
    config: config.embedding,
    logger,
  });

  // 4d. KnowledgeService -- knowledge persistence with semantic search
  const knowledgeService = createKnowledgeService({
    db,
    embeddingService,
    logger,
  });

  // 4e. DirectoryService -- entity discovery with semantic capability matching
  const directoryService = createDirectoryService({
    db,
    embeddingService,
    logger,
  });

  registerAllTools({
    registry: toolRegistry,
    agentRegistry,
    taskService,
    knowledgeService,
    directoryService,
    logger,
  });

  // 5. EventLog -- buffered append-only event recording
  const eventLog = createEventLog({ db, logger });

  // 6. SessionProjection -- reactive agent_sessions updates
  const artifactConfig: ArtifactExtractionConfig = new Map([
    [
      "github:create_pull_request",
      { artifactKey: "pr_url", payloadPath: "result.url" },
    ],
    [
      "github:create_branch",
      { artifactKey: "branch_name", payloadPath: "result.branch" },
    ],
  ]);
  const sessionProjection = createSessionProjection({
    db,
    logger,
    eventLog,
    artifactConfig,
  });

  // 7. TimeoutScheduler -- pg-boss delayed signal delivery
  const timeoutScheduler = createTimeoutScheduler({ pool, logger });

  // 7b. SandboxManager -- Docker-backed dev containers (swap for Fargate/Lambda in prod)
  const sandboxManager = createDevContainerManager({ db: platformDb, logger });

  // 8. ConversationExecutor -- SKIP LOCKED conversation lifecycle
  const executor = createConversationExecutor({
    db,
    eventLog,
    sessionProjection,
    agentRegistry,
    toolRegistry,
    logger,
    timeoutScheduler,
    sandboxManager,
    sandboxSetup: config.github.repoUrl
      ? {
          repoUrl: config.github.repoUrl,
          ...(config.github.token && { githubToken: config.github.token }),
          ...(config.github.baseBranch && {
            baseBranch: config.github.baseBranch,
          }),
        }
      : undefined,
    pollIntervalMs: config.service.workerPollIntervalMs,
    concurrencyLimit: config.service.maxConcurrentConversations,
    taskService,
  });

  // 8b. Knowledge cleanup -- hourly hard-delete of entries expired 24h+ ago
  // Uses setInterval (single-process deployment). The 24h grace period after expiry
  // allows debugging before permanent deletion. cleanupExpired() is idempotent.
  const KNOWLEDGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const knowledgeCleanupTimer = setInterval(async () => {
    try {
      const deleted = await knowledgeService.cleanupExpired();
      if (deleted > 0) {
        logger.info({ deletedCount: deleted }, "Knowledge cleanup completed");
      }
    } catch (err) {
      logger.error({ err }, "Knowledge cleanup failed");
    }
  }, KNOWLEDGE_CLEANUP_INTERVAL_MS);
  knowledgeCleanupTimer.unref(); // Don't prevent process exit

  // 9. EventRouter -- deterministic event-to-agent routing
  const eventRouter = createEventRouter({ agentRegistry, logger });
  await eventRouter.loadStartRules();

  // 10. Express app
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // 10a. Management API -- /api/ prefix for tools, agents, worker, SSE
  const integrations = [
    { name: "linear", healthUrl: `${config.mcp.linear.url}/health` },
    { name: "github", healthUrl: `${config.mcp.github.url}/health` },
    { name: "slack", healthUrl: `${config.mcp.slack.url}/health` },
  ];

  const { router: apiRouter, sseManager } = createApiRouter({
    toolRegistry,
    agentRegistry,
    getWorkerStatus: () => executor.getWorkerStatus(),
    eventLog,
    integrations,
    logger,
  });

  app.use("/api", apiRouter);

  // Route dependencies (shared across POST /events calls)
  const routeEventDeps: RouteEventDeps = {
    executor,
    eventRouter,
    logger,
    alertsChannel: config.router.alertsChannel,
    linearTeamId: config.linear.teamId,
    githubOwner: config.github.owner,
    githubRepo: config.github.repo,
    githubBaseBranch: config.github.baseBranch,
    slackTeamId: config.slack.teamId,
    notifyChannels: {
      "dev-agent": config.notify.devAgent,
      "product-agent": config.notify.productAgent,
    },
    taskService, // Phase 58.4: task-aware routing
    db, // Phase 58.4: advisory lock transactions
  };

  // GET /health -- liveness check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agent-service" });
  });

  // POST /events -- receive NormalizedEvent, route through pipeline
  app.post("/events", async (req, res) => {
    try {
      const parsed = NormalizedEventSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Validation failed", issues: parsed.error.issues });
        return;
      }

      const result = await routeEvent(parsed.data, routeEventDeps);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "POST /events failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /conversations/:id -- retrieve conversation info
  app.get("/conversations/:id", async (req, res) => {
    try {
      const info = await executor.get(req.params.id);
      if (!info) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      res.json(info);
    } catch (error) {
      logger.error(
        { err: error, conversationId: req.params.id },
        "GET /conversations/:id failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /conversations/:id/cancel -- cancel a conversation
  app.post("/conversations/:id/cancel", async (req, res) => {
    try {
      const cancelled = await executor.cancel(req.params.id);
      if (!cancelled) {
        res
          .status(409)
          .json({ error: "Conversation already in terminal state" });
        return;
      }
      res.json({ cancelled: true });
    } catch (error) {
      logger.error(
        { err: error, conversationId: req.params.id },
        "POST /conversations/:id/cancel failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /conversations/:id/reopen -- reopen a terminal conversation
  app.post("/conversations/:id/reopen", async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res
          .status(400)
          .json({ error: "reason is required and must be non-empty" });
        return;
      }

      const result = await executor.reopen(req.params.id, reason);
      if (result.action === "rejected") {
        const statusCode = result.error?.includes("not found") ? 404 : 400;
        res.status(statusCode).json({ error: result.error });
        return;
      }

      res.json({ reopened: true });
    } catch (error) {
      logger.error(
        { err: error, conversationId: req.params.id },
        "POST /conversations/:id/reopen failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // 11. Start HTTP server
  const server = app.listen(config.service.port, () => {
    logger.info({ port: config.service.port }, "Agent service listening");
  });

  // 12. Start worker loop (AFTER server is listening)
  executor.startWorker();

  // 13. Graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Graceful shutdown initiated");

    // 1. Stop knowledge cleanup timer
    clearInterval(knowledgeCleanupTimer);

    // 2. Close all SSE connections (clients get disconnected cleanly)
    sseManager.closeAll();

    // 3. Stop accepting HTTP connections
    server.close();

    // 4. Stop worker + drain conversations + flush event log + stop pg-boss
    await executor.stopWorker();

    // 5. Final event log flush (belt + suspenders)
    await eventLog.close();

    // 6. Close session projection subscriptions
    sessionProjection.close();

    // 7. Close sandbox manager
    await sandboxManager.close();

    // 8. Close database pool
    await pool.end();

    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Force exit after grace period
  const forceTimeout = setTimeout(() => {
    if (isShuttingDown) {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }
  }, config.service.forceShutdownTimeoutMs);
  forceTimeout.unref();
}

bootstrap().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: Pre-logger startup error
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
