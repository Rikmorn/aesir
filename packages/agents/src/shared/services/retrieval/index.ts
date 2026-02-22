/**
 * Retrieval Pipeline Module
 *
 * Pluggable retrieval architecture for knowledge search.
 * Supports multiple strategies (vector, keyword) with RRF score fusion.
 *
 * Usage:
 * - Import types for strategy/pipeline contracts
 * - Import createRetrievalPipeline for instantiation
 * - Import getRegisteredStrategyNames for config validation
 * - Import strategy factories for direct use or registration
 * - Import reciprocalRankFusion for testing
 */

// Fusion
export { RRF_K, reciprocalRankFusion } from "./fusion.js";
export type {
  RetrievalPipeline,
  RetrievalPipelineOptions,
} from "./pipeline.js";
// Pipeline factory and strategy registry
export {
  createRetrievalPipeline,
  getRegisteredStrategyNames,
} from "./pipeline.js";
export { createKeywordStrategy } from "./strategies/keyword-strategy.js";

// Strategy factories
export { createVectorStrategy } from "./strategies/vector-strategy.js";
// Types
export type {
  RetrievalConfig,
  RetrievalScope,
  RetrievalStrategy,
  ScoredResult,
  StrategyFactory,
} from "./types.js";
