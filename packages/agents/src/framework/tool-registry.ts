/**
 * ToolRegistry Implementation
 *
 * Maps tool reference strings (namespace:tool_name) to factory functions.
 * When an agent's tool references are resolved, each factory is called
 * with a ToolContext to produce a bound ToolDefinition.
 *
 * @example
 * ```typescript
 * const registry = createToolRegistry({ logger });
 * registry.register("linear:get_issue", (ctx) => createGetIssueTool(ctx));
 * const tools = registry.resolve(["linear:get_issue"], context);
 * ```
 */

import type { PinoLogger } from "@aesir/platform";
import type { ToolContext, ToolFactory, ToolRegistry } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolRegistryOptions {
  /** Logger instance for diagnostic output */
  logger: PinoLogger;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Pattern for valid tool reference strings: namespace:tool_name */
const TOOL_REF_PATTERN = /^[a-z]+:[a-z_]+$/;

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a ToolRegistry instance.
 *
 * The registry maintains an internal Map of tool reference strings to
 * factory functions. Registration is strict: duplicates and invalid
 * formats are rejected immediately with descriptive errors.
 *
 * Resolution calls each factory with the provided ToolContext, producing
 * ToolDefinition objects ready for the agent loop. If any references
 * are unresolvable, all missing refs are listed in the error.
 */
export function createToolRegistry(options: ToolRegistryOptions): ToolRegistry {
  const { logger } = options;
  const factories = new Map<string, ToolFactory>();

  return {
    register(ref: string, factory: ToolFactory): void {
      if (!TOOL_REF_PATTERN.test(ref)) {
        throw new Error(
          `Invalid tool reference format: "${ref}". Must match namespace:tool_name (lowercase letters and underscores only).`,
        );
      }

      if (factories.has(ref)) {
        throw new Error(
          `Tool reference "${ref}" is already registered. Duplicate registrations are not allowed.`,
        );
      }

      factories.set(ref, factory);
      logger.debug({ toolRef: ref }, "Tool factory registered");
    },

    resolve(toolRefs: string[], context: ToolContext) {
      // Collect all missing refs before throwing (report all at once)
      const missing: string[] = [];
      for (const ref of toolRefs) {
        if (!factories.has(ref)) {
          missing.push(ref);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `Unknown tool reference(s): ${missing.map((r) => `"${r}"`).join(", ")}. ` +
            `Registered tools: [${Array.from(factories.keys()).sort().join(", ")}]`,
        );
      }

      return toolRefs.map((ref) => {
        const factory = factories.get(ref);
        // Safe assertion: we checked all refs above
        return factory!(context);
      });
    },

    has(ref: string): boolean {
      return factories.has(ref);
    },

    listRegistered(): string[] {
      return Array.from(factories.keys()).sort();
    },
  };
}
