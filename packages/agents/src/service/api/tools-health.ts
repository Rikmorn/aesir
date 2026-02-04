/**
 * Tools Health Endpoint
 *
 * GET /api/tools/health
 *
 * Checks health of all integration services (Linear, GitHub, Slack)
 * by hitting their /health endpoints. Results are cached with a 30s TTL.
 * Uses Promise.allSettled so one slow/failed integration does not block others.
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import { asyncHandler } from "./middleware.js";
import type { IntegrationHealth, ToolsHealthResponse } from "./types.js";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ToolsHealthRouterOptions {
  /** Integration endpoints to health-check */
  integrations: Array<{ name: string; healthUrl: string }>;
  /** Logger instance */
  logger: PinoLogger;
  /** Cache TTL in milliseconds (default: 30_000) */
  cacheTtlMs?: number;
  /** Per-integration fetch timeout in milliseconds (default: 3000) */
  timeoutMs?: number;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CachedHealth {
  data: ToolsHealthResponse;
  fetchedAt: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a router for the tools health endpoint.
 *
 * Health checks hit each integration's /health endpoint in parallel.
 * Results are cached for cacheTtlMs (default 30s) to avoid hammering
 * integrations on rapid dashboard refreshes.
 */
export function createToolsHealthRouter(
  options: ToolsHealthRouterOptions,
): Router {
  const {
    integrations,
    logger: parentLogger,
    cacheTtlMs = 30_000,
    timeoutMs = 3000,
  } = options;
  const logger = parentLogger.child({ component: "api-tools-health" });
  const router = Router();

  let cache: CachedHealth | null = null;

  /**
   * Check a single integration's health endpoint.
   */
  async function checkIntegration(integration: {
    name: string;
    healthUrl: string;
  }): Promise<IntegrationHealth> {
    const start = Date.now();
    try {
      const response = await fetch(integration.healthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      return {
        name: integration.name,
        status: response.ok ? "healthy" : "unhealthy",
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      logger.warn(
        { err, integration: integration.name },
        "Integration health check failed",
      );
      return {
        name: integration.name,
        status: "unhealthy",
        latencyMs: null,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  router.get(
    "/",
    asyncHandler(logger, async (_req, res) => {
      const now = Date.now();

      // Return cached if still fresh
      if (cache && now - cache.fetchedAt < cacheTtlMs) {
        res.json(cache.data);
        return;
      }

      // Check all integrations in parallel (one failure does not block others)
      const results = await Promise.allSettled(
        integrations.map((i) => checkIntegration(i)),
      );

      const healthResults: IntegrationHealth[] = results.map(
        (result, index) => {
          if (result.status === "fulfilled") {
            return result.value;
          }
          // Promise.allSettled rejection (shouldn't happen given our try/catch, but defensive)
          const integration = integrations[index];
          return {
            name: integration?.name ?? "unknown",
            status: "unhealthy" as const,
            latencyMs: null,
            lastChecked: new Date().toISOString(),
          };
        },
      );

      const data: ToolsHealthResponse = { integrations: healthResults };
      cache = { data, fetchedAt: now };
      res.json(data);
    }),
  );

  return router;
}
