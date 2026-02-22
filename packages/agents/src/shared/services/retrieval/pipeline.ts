/**
 * Retrieval Pipeline
 *
 * Factory-based retrieval pipeline that runs multiple strategies in parallel,
 * fuses results with RRF when multiple strategies succeed, and provides
 * graceful degradation when individual strategies fail.
 *
 * Strategy Registration:
 * - Module-level `strategies` Map is populated at import time with "vector"
 *   and "keyword" factories
 * - `getRegisteredStrategyNames()` works without pipeline instantiation
 *   (used for YAML config validation in agent-registry)
 * - New strategies can be added via `strategies.set()` at module level
 *
 * Pipeline Lifecycle:
 * - Created per agent definition via `createRetrievalPipeline()`
 * - NOT instantiated when agents have no retrieval config (zero-overhead)
 * - Runs strategies via Promise.allSettled for graceful degradation
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../db/schema.js";
import type { EmbeddingService } from "../../embedding/types.js";
import { reciprocalRankFusion } from "./fusion.js";
import { createKeywordStrategy } from "./strategies/keyword-strategy.js";
import { createVectorStrategy } from "./strategies/vector-strategy.js";
import type {
  RetrievalConfig,
  RetrievalScope,
  ScoredResult,
  StrategyFactory,
} from "./types.js";

// ─── Module-Level Strategy Registry ─────────────────────────────────────────

/**
 * Module-level strategy registry. Populated at import time with built-in
 * strategies. New strategies can be added via `strategies.set()` without
 * modifying pipeline code.
 */
const strategies = new Map<string, StrategyFactory>();
strategies.set("vector", createVectorStrategy);
strategies.set("keyword", createKeywordStrategy);

/**
 * Returns the names of all registered strategies.
 * Works without pipeline instantiation -- used for YAML config validation
 * in agent-registry (Plan 03).
 */
export function getRegisteredStrategyNames(): string[] {
  return Array.from(strategies.keys());
}

// ─── Pipeline Interface ─────────────────────────────────────────────────────

export interface RetrievalPipeline {
  /**
   * Execute retrieval across configured strategies, fuse results with RRF,
   * and return the top results up to the configured limit.
   */
  search(
    query: string,
    scope: RetrievalScope,
    config: RetrievalConfig,
  ): Promise<ScoredResult[]>;
}

export interface RetrievalPipelineOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  embeddingService: EmbeddingService;
  logger: PinoLogger;
}

// ─── Pipeline Factory ───────────────────────────────────────────────────────

const DEFAULT_RESULT_LIMIT = 10;

/**
 * Create a retrieval pipeline instance.
 *
 * The pipeline reads from the module-level strategies Map to resolve
 * strategy factories. Each search() call creates strategy instances,
 * runs them in parallel, and fuses results.
 */
export function createRetrievalPipeline(
  options: RetrievalPipelineOptions,
): RetrievalPipeline {
  const { db, embeddingService, logger } = options;
  const log = logger.child({ component: "retrieval-pipeline" });

  return {
    async search(
      query: string,
      scope: RetrievalScope,
      config: RetrievalConfig,
    ): Promise<ScoredResult[]> {
      const resultLimit = config.resultLimit ?? DEFAULT_RESULT_LIMIT;

      // Resolve strategy factories and create instances
      const strategyEntries: Array<{
        type: string;
        weight: number;
        instance: ReturnType<StrategyFactory>;
      }> = [];

      for (const strategyConfig of config.strategies) {
        const factory = strategies.get(strategyConfig.type);
        if (!factory) {
          log.warn(
            { strategyType: strategyConfig.type },
            "Unknown strategy type, skipping",
          );
          continue;
        }

        // Pass strategy-specific config (spread the config, add embeddingService for vector)
        const instanceConfig: Record<string, unknown> = {
          ...strategyConfig,
          embeddingService,
        };

        try {
          const instance = factory(db, instanceConfig);
          strategyEntries.push({
            type: strategyConfig.type,
            weight: strategyConfig.weight,
            instance,
          });
        } catch (err) {
          log.error(
            { err, strategyType: strategyConfig.type },
            "Failed to create strategy instance, skipping",
          );
        }
      }

      if (strategyEntries.length === 0) {
        log.warn("No valid strategies resolved, returning empty results");
        return [];
      }

      // Run all strategies in parallel with graceful degradation
      const searchPromises = strategyEntries.map(async (entry) => {
        const results = await entry.instance.search(query, scope, resultLimit);
        return { type: entry.type, weight: entry.weight, results };
      });

      const settled = await Promise.allSettled(searchPromises);

      // Collect successful results, log failures
      const successfulResults: Array<{
        results: ScoredResult[];
        weight: number;
      }> = [];

      for (const [i, settledResult] of settled.entries()) {
        const strategyEntry = strategyEntries[i];
        if (settledResult.status === "fulfilled") {
          successfulResults.push({
            results: settledResult.value.results,
            weight: settledResult.value.weight,
          });
        } else if (strategyEntry) {
          log.error(
            { err: settledResult.reason, strategyType: strategyEntry.type },
            "Strategy search failed (graceful degradation)",
          );
        }
      }

      if (successfulResults.length === 0) {
        log.warn("All strategies failed, returning empty results");
        return [];
      }

      // If only one strategy succeeded, return its results directly (no fusion needed)
      if (successfulResults.length === 1) {
        const singleResult = successfulResults[0];
        return singleResult ? singleResult.results.slice(0, resultLimit) : [];
      }

      // Multiple strategies succeeded -- fuse with RRF
      const fused = reciprocalRankFusion(successfulResults);
      return fused.slice(0, resultLimit);
    },
  };
}
