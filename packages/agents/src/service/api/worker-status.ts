/**
 * Worker Status Endpoint
 *
 * GET /api/worker/status
 *
 * Returns the current worker loop status including active claims,
 * concurrency limit, poll interval, last poll time, and uptime.
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import type { WorkerLoopStatus } from "../../framework/worker-loop.js";
import { asyncHandler } from "./middleware.js";
import type { WorkerStatusResponse } from "./types.js";

// ─── Options ──────────────────────────────────────────────────────────────────

interface WorkerStatusRouterOptions {
  /** Callback to get current worker loop status (null if not started) */
  getWorkerStatus: () => WorkerLoopStatus | null;
  logger: PinoLogger;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a router for the worker status endpoint.
 *
 * Returns a snapshot of the worker loop's current state.
 * If the worker loop hasn't started yet, returns zeroed-out values.
 */
export function createWorkerStatusRouter(
  options: WorkerStatusRouterOptions,
): Router {
  const { getWorkerStatus, logger: parentLogger } = options;
  const logger = parentLogger.child({ component: "api-worker-status" });
  const router = Router();

  router.get(
    "/",
    asyncHandler(logger, async (_req, res) => {
      const status = getWorkerStatus();

      if (!status) {
        // Worker loop not started yet
        const response: WorkerStatusResponse = {
          activeClaims: 0,
          maxConcurrent: 0,
          pollIntervalMs: 0,
          lastPollAt: null,
          uptimeMs: 0,
        };
        res.json(response);
        return;
      }

      const response: WorkerStatusResponse = {
        activeClaims: status.activeClaims,
        maxConcurrent: status.maxConcurrent,
        pollIntervalMs: status.pollIntervalMs,
        lastPollAt: status.lastPollAt ? status.lastPollAt.toISOString() : null,
        uptimeMs: status.uptimeMs,
      };
      res.json(response);
    }),
  );

  return router;
}
