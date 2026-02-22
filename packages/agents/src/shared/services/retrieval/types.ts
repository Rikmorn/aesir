/**
 * Retrieval Pipeline Types
 *
 * Core type contract for the pluggable retrieval pipeline.
 * Defines the strategy interface, scored results, scope visibility,
 * and configuration shapes used throughout the retrieval module.
 *
 * Strategy factories receive (db, config) and return a RetrievalStrategy.
 * Each factory validates its own config block -- the pipeline only validates
 * the top-level shape (type + weight).
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../db/schema.js";

// ─── Scored Result ──────────────────────────────────────────────────────────

/**
 * A search result with a relevance score from a retrieval strategy.
 * Scores are strategy-specific and will be normalized during fusion.
 */
export interface ScoredResult {
  id: string;
  score: number;
  content: string;
  topic: string;
  type: string;
  author: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ─── Retrieval Scope ────────────────────────────────────────────────────────

/**
 * Defines visibility scope for retrieval queries.
 * Strategies apply: shared entries + own private entries for the given agentId.
 */
export interface RetrievalScope {
  agentId: string;
}

// ─── Retrieval Strategy ─────────────────────────────────────────────────────

/**
 * Interface for pluggable retrieval strategies.
 * Each strategy implements a different search approach (vector, keyword, etc.)
 * and returns scored results that can be fused by the pipeline.
 */
export interface RetrievalStrategy {
  /** Strategy type name (e.g., "vector", "keyword") */
  readonly type: string;
  /** Execute search and return scored results */
  search(
    query: string,
    scope: RetrievalScope,
    limit: number,
  ): Promise<ScoredResult[]>;
}

// ─── Strategy Factory ───────────────────────────────────────────────────────

/**
 * Factory function that creates a RetrievalStrategy instance.
 * Each factory validates its own config block from the strategy entry.
 */
export type StrategyFactory = (
  db: NodePgDatabase<typeof agentsSchemaModule>,
  config: Record<string, unknown>,
) => RetrievalStrategy;

// ─── Retrieval Config ───────────────────────────────────────────────────────

/**
 * Per-agent retrieval configuration (matches the Zod schema shape from YAML).
 * Strategies are run in parallel and fused with RRF when multiple succeed.
 */
export interface RetrievalConfig {
  strategies: Array<{
    type: string;
    weight: number;
    [key: string]: unknown;
  }>;
  resultLimit?: number;
}
