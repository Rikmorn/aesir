/**
 * Tools Registry Endpoint
 *
 * GET /api/tools/registry
 *
 * Returns all registered tools with name, namespace, description,
 * and JSON Schema representation of their input parameters.
 * Results are cached on first call (tool registrations are immutable at runtime).
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolContext, ToolRegistry } from "../../framework/types.js";
import { asyncHandler } from "./middleware.js";
import type { ToolRegistryEntry } from "./types.js";

// ─── Options ──────────────────────────────────────────────────────────────────

interface ToolsRegistryRouterOptions {
  toolRegistry: ToolRegistry;
  logger: PinoLogger;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a router for the tools registry endpoint.
 *
 * Uses a minimal "inspection" ToolContext to resolve tool metadata.
 * Only name, description, and inputSchema are read -- execute() is never called.
 */
export function createToolsRegistryRouter(
  options: ToolsRegistryRouterOptions,
): Router {
  const { toolRegistry, logger: parentLogger } = options;
  const logger = parentLogger.child({ component: "api-tools-registry" });
  const router = Router();

  // Cache resolved on first request (tool registrations don't change at runtime)
  let cache: ToolRegistryEntry[] | null = null;

  router.get(
    "/",
    asyncHandler(logger, async (_req, res) => {
      if (cache) {
        res.json(cache);
        return;
      }

      const refs = toolRegistry.listRegistered();

      // Minimal inspection context -- safe because we only read metadata
      const inspectionContext: ToolContext = {
        agentId: "__inspection__",
        correlationId: "__inspection__",
        logger: logger.child({ context: "inspection" }),
      };

      const entries: ToolRegistryEntry[] = [];

      for (const ref of refs) {
        const colonIdx = ref.indexOf(":");
        const namespace = ref.slice(0, colonIdx);
        const name = ref.slice(colonIdx + 1);

        try {
          // Resolve single tool ref with inspection context
          const [toolDef] = toolRegistry.resolve([ref], inspectionContext);
          if (!toolDef) {
            entries.push({
              name,
              namespace,
              description: "Unable to load",
              inputSchema: {},
            });
            continue;
          }

          // Convert Zod schema to JSON Schema
          let jsonSchema: Record<string, unknown> = {};
          try {
            jsonSchema = zodToJsonSchema(toolDef.inputSchema) as Record<
              string,
              unknown
            >;
          } catch {
            logger.warn(
              { toolRef: ref },
              "Failed to convert inputSchema to JSON Schema",
            );
          }

          entries.push({
            name: toolDef.name,
            namespace,
            description: toolDef.description,
            inputSchema: jsonSchema,
          });
        } catch (err) {
          // Factory threw (e.g., codebase tools need containerManager).
          // Fall back to minimal entry with just name and namespace.
          logger.debug(
            { err, toolRef: ref },
            "Tool factory threw during inspection, using fallback metadata",
          );
          entries.push({
            name,
            namespace,
            description: "Unable to load",
            inputSchema: {},
          });
        }
      }

      // Sort by namespace then name
      entries.sort((a, b) => {
        const nsCmp = a.namespace.localeCompare(b.namespace);
        if (nsCmp !== 0) return nsCmp;
        return a.name.localeCompare(b.name);
      });

      cache = entries;
      res.json(entries);
    }),
  );

  return router;
}
