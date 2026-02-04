/**
 * Agents Registry Endpoints
 *
 * GET /api/agents/registry       - List all agent definitions (without systemPrompt)
 * GET /api/agents/registry/:id   - Get a single agent definition (with systemPrompt)
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import { z } from "zod";
import type { AgentDefinition, AgentRegistry } from "../../framework/types.js";
import { asyncHandler, sendApiError, validateParams } from "./middleware.js";
import {
  type AgentRegistryDetail,
  type AgentRegistrySummary,
  ErrorCodes,
} from "./types.js";

// ─── Options ──────────────────────────────────────────────────────────────────

interface AgentsRegistryRouterOptions {
  agentRegistry: AgentRegistry;
  logger: PinoLogger;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Agent ID must be lowercase letters, numbers, and hyphens */
const agentIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9-]+$/,
    "Agent ID must be lowercase letters, numbers, and hyphens",
  );

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map an AgentDefinition to a summary (without systemPrompt).
 */
function toSummary(def: AgentDefinition): AgentRegistrySummary {
  const { systemPrompt: _systemPrompt, ...summary } = def;
  return summary;
}

/**
 * Map an AgentDefinition to a detail response (with systemPrompt).
 */
function toDetail(def: AgentDefinition): AgentRegistryDetail {
  return def;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a router for the agents registry endpoints.
 *
 * - GET / returns all definitions without system prompts (lightweight list)
 * - GET /:id returns a single definition with the full system prompt
 */
export function createAgentsRegistryRouter(
  options: AgentsRegistryRouterOptions,
): Router {
  const { agentRegistry, logger: parentLogger } = options;
  const logger = parentLogger.child({ component: "api-agents-registry" });
  const router = Router();

  // GET / -- list all agent definitions (without systemPrompt)
  router.get(
    "/",
    asyncHandler(logger, async (_req, res) => {
      const definitions = await agentRegistry.list();
      const summaries = definitions.map(toSummary);
      // Sort by id for stable ordering
      summaries.sort((a, b) => a.id.localeCompare(b.id));
      res.json(summaries);
    }),
  );

  // GET /:id -- get a single agent definition (with systemPrompt)
  router.get(
    "/:id",
    asyncHandler(logger, async (req, res) => {
      const validation = validateParams(agentIdSchema, req.params.id);
      if (!validation.success) {
        sendApiError(
          res,
          400,
          ErrorCodes.VALIDATION_ERROR,
          "Invalid agent ID",
          validation.error.issues,
        );
        return;
      }

      const definition = await agentRegistry.get(validation.data);
      if (!definition) {
        sendApiError(
          res,
          404,
          ErrorCodes.NOT_FOUND,
          `Agent not found: ${validation.data}`,
        );
        return;
      }

      res.json(toDetail(definition));
    }),
  );

  return router;
}
