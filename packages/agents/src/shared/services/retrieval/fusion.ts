/**
 * Reciprocal Rank Fusion (RRF)
 *
 * Pure function that combines results from multiple retrieval strategies
 * into a single ranked list using RRF scoring.
 *
 * Formula: fusionScore(doc) = sum(normalizedWeight_i / (k + rank_i + 1))
 * where rank_i is the 0-indexed position in strategy i's results.
 *
 * RRF is score-distribution-agnostic: it uses rank positions, not raw scores,
 * so it works well with strategies that produce different score scales
 * (e.g., cosine similarity [0,1] vs ts_rank [0, inf)).
 *
 * k=60 is the standard constant used by Elasticsearch, Vespa, and most
 * production systems. It provides good balance between emphasizing top-ranked
 * results and considering deeper results.
 *
 * References: Cormack et al., 2009 -- "Reciprocal Rank Fusion outperforms
 * Condorcet and individual Rank Learning Methods"
 */

import type { ScoredResult } from "./types.js";

/**
 * Standard RRF constant. Higher k dampens the influence of rank position,
 * giving more uniform contribution across ranks. k=60 is the industry standard.
 * NOT configurable per user decision.
 */
export const RRF_K = 60;

/**
 * Fuse results from multiple retrieval strategies using Reciprocal Rank Fusion.
 *
 * Weights are relative and normalized: [0.7, 0.3] is equivalent to [7, 3].
 * Same result IDs from different strategies have their contributions summed.
 * Returns results sorted by descending fused score.
 *
 * Edge cases:
 * - Empty input: returns []
 * - Single strategy: passes through with RRF-adjusted scores
 * - Zero-weight strategy: skipped entirely
 */
export function reciprocalRankFusion(
  strategyResults: Array<{ results: ScoredResult[]; weight: number }>,
): ScoredResult[] {
  // Edge case: no strategies
  if (strategyResults.length === 0) {
    return [];
  }

  // Filter out zero-weight strategies
  const validStrategies = strategyResults.filter((s) => s.weight > 0);
  if (validStrategies.length === 0) {
    return [];
  }

  // Normalize weights
  const totalWeight = validStrategies.reduce((sum, s) => sum + s.weight, 0);

  // Accumulate fused scores by result ID
  const fusionScores = new Map<
    string,
    { score: number; result: ScoredResult }
  >();

  for (const { results, weight } of validStrategies) {
    const normalizedWeight = weight / totalWeight;
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank] as ScoredResult;
      const contribution = normalizedWeight / (RRF_K + rank + 1);
      const existing = fusionScores.get(result.id);
      if (existing) {
        existing.score += contribution;
      } else {
        fusionScores.set(result.id, { score: contribution, result });
      }
    }
  }

  // Sort by descending fused score, update score field in results
  return Array.from(fusionScores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, score }));
}
