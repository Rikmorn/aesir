/**
 * AgentRegistry
 *
 * Loads agent definitions from YAML + prompt.md files on disk,
 * validates with Zod, and caches in memory with mtime-based invalidation.
 *
 * Each agent is a directory under `definitionsDir` containing:
 *   - definition.yaml  (validated against AgentDefinitionYamlSchema)
 *   - prompt.md         (raw system prompt text)
 *
 * New agent = new directory. No code changes needed.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { PinoLogger } from "@aesir/platform";
import { parse } from "yaml";

import type { AgentDefinition, AgentRegistry } from "./types.js";
import { AgentDefinitionYamlSchema } from "./types.js";

// ─── Options ─────────────────────────────────────────────────────────────────

export interface AgentRegistryOptions {
  /** Absolute path to definitions directory */
  definitionsDir: string;
  /** Logger instance */
  logger: PinoLogger;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface CacheEntry {
  definition: AgentDefinition;
  /** Max of definition.yaml and prompt.md mtimeMs */
  mtime: number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAgentRegistry(
  options: AgentRegistryOptions,
): AgentRegistry {
  const { definitionsDir, logger } = options;
  const cache = new Map<string, CacheEntry>();

  async function loadDefinition(id: string): Promise<AgentDefinition | null> {
    const defDir = join(definitionsDir, id);
    const yamlPath = join(defDir, "definition.yaml");
    const promptPath = join(defDir, "prompt.md");

    // Check file existence via stat. If either file is missing, agent not found.
    let yamlStat: Awaited<ReturnType<typeof stat>>;
    let promptStat: Awaited<ReturnType<typeof stat>>;
    try {
      yamlStat = await stat(yamlPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    try {
      promptStat = await stat(promptPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }

    // Use the latest mtime of either file for cache invalidation
    const mtime = Math.max(yamlStat.mtimeMs, promptStat.mtimeMs);

    // Return cached if still fresh
    const cached = cache.get(id);
    if (cached && cached.mtime >= mtime) {
      return cached.definition;
    }

    // Load and parse
    const yamlContent = await readFile(yamlPath, "utf-8");
    const promptContent = await readFile(promptPath, "utf-8");

    const parsed: unknown = parse(yamlContent);
    const config = AgentDefinitionYamlSchema.parse(parsed);

    // Verify directory name matches definition id
    if (config.id !== id) {
      throw new Error(
        `Agent definition id '${config.id}' does not match directory name '${id}'`,
      );
    }

    // Build AgentDefinition, respecting exactOptionalPropertyTypes
    const definition: AgentDefinition = {
      id: config.id,
      name: config.name,
      description: config.description,
      version: config.version,
      model: config.model,
      tools: config.tools,
      maxIterations: config.maxIterations,
      tokenBudget: config.tokenBudget,
      history: config.history,
      systemPrompt: promptContent,
    };
    if (config.temperature !== undefined) {
      (definition as { temperature: number }).temperature = config.temperature;
    }
    if (config.subAgents !== undefined) {
      (definition as { subAgents: Record<string, string> }).subAgents =
        config.subAgents;
    }
    if (config.triggers !== undefined) {
      (definition as { triggers: Array<{ event: string }> }).triggers =
        config.triggers;
    }
    if (config.capabilities !== undefined) {
      (definition as { capabilities: string[] }).capabilities =
        config.capabilities;
    }

    // Cache and log
    cache.set(id, { definition, mtime });
    logger.debug(
      { agentId: id, version: config.version },
      "Agent definition loaded",
    );

    return definition;
  }

  return {
    async get(id: string, version?: string): Promise<AgentDefinition | null> {
      const result = await loadDefinition(id);
      if (result === null) {
        return null;
      }
      if (version !== undefined && result.version !== version) {
        logger.warn(
          {
            agentId: id,
            requestedVersion: version,
            cachedVersion: result.version,
          },
          "Agent definition version mismatch -- returning cached version",
        );
      }
      return result;
    },

    async list(): Promise<AgentDefinition[]> {
      const entries = await readdir(definitionsDir, { withFileTypes: true });
      const directories = entries.filter((e) => e.isDirectory());
      const results = await Promise.all(
        directories.map((d) => loadDefinition(d.name)),
      );
      return results.filter((d): d is AgentDefinition => d !== null);
    },
  };
}
