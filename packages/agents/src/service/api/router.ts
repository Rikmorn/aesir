/**
 * API Router
 *
 * Combines all /api/ sub-routers into a single Express Router.
 * Mounted at /api in main.ts.
 *
 * Endpoints:
 * - GET /api/tools/registry    -- registered tools with metadata
 * - GET /api/tools/health      -- integration health checks (cached)
 * - GET /api/agents/registry   -- agent definitions (without prompt)
 * - GET /api/agents/registry/:id -- agent definition (with prompt)
 * - GET /api/worker/status     -- worker loop status
 * - GET /api/sse/events        -- SSE event stream
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import type {
  AgentRegistry,
  EventLog,
  ToolRegistry,
} from "../../framework/types.js";
import type { WorkerLoopStatus } from "../../framework/worker-loop.js";
import { createAgentsRegistryRouter } from "./agents-registry.js";
import {
  createSseEventsRouter,
  type SseConnectionManager,
} from "./sse-events.js";
import { createToolsHealthRouter } from "./tools-health.js";
import { createToolsRegistryRouter } from "./tools-registry.js";
import { createWorkerStatusRouter } from "./worker-status.js";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ApiRouterOptions {
  /** Tool registry for tools endpoint */
  toolRegistry: ToolRegistry;
  /** Agent registry for agents endpoint */
  agentRegistry: AgentRegistry;
  /** Callback to get worker loop status */
  getWorkerStatus: () => WorkerLoopStatus | null;
  /** Event log for SSE bridge (used in Plan 02) */
  eventLog: EventLog;
  /** Integration endpoints for health checks */
  integrations: Array<{ name: string; healthUrl: string }>;
  /** Logger instance */
  logger: PinoLogger;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the combined API router that mounts all sub-routers.
 *
 * Returns both the Express Router and the SSE connection manager
 * (main.ts needs the manager for graceful shutdown).
 */
export function createApiRouter(options: ApiRouterOptions): {
  router: Router;
  sseManager: SseConnectionManager;
} {
  const {
    toolRegistry,
    agentRegistry,
    getWorkerStatus,
    eventLog,
    integrations,
    logger,
  } = options;

  const router = Router();

  // Mount REST sub-routers
  router.use(
    "/tools/registry",
    createToolsRegistryRouter({ toolRegistry, logger }),
  );

  router.use(
    "/tools/health",
    createToolsHealthRouter({ integrations, logger }),
  );

  router.use(
    "/agents/registry",
    createAgentsRegistryRouter({ agentRegistry, logger }),
  );

  router.use(
    "/worker/status",
    createWorkerStatusRouter({ getWorkerStatus, logger }),
  );

  // Mount SSE sub-router
  const { router: sseRouter, manager: sseManager } = createSseEventsRouter({
    eventLog,
    logger,
  });
  router.use("/sse/events", sseRouter);

  return { router, sseManager };
}
