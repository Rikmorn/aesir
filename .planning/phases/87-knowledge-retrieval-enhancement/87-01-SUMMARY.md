---
phase: 87-knowledge-retrieval-enhancement
plan: 01
subsystem: agents
tags: [retrieval, pgvector, tsvector, rrf, strategy-pattern, knowledge]

# Dependency graph
requires:
  - phase: 67-knowledge-store
    provides: knowledge_entries table with pgvector embeddings, KnowledgeService
provides:
  - RetrievalStrategy interface with search(query, scope, limit) contract
  - Vector strategy wrapping existing cosine distance logic
  - Keyword strategy using PostgreSQL tsvector/tsquery
  - RRF score fusion with k=60 and weight normalization
  - Pipeline factory with module-level strategy Map registry
  - GIN fulltext index migration for keyword search performance
affects: [87-02-PLAN, 87-03-PLAN, knowledge-query-tool, agent-registry]

# Tech tracking
tech-stack:
  added: []
  patterns: [strategy-pattern-with-factory-map, reciprocal-rank-fusion, promise-allsettled-graceful-degradation]

key-files:
  created:
    - packages/agents/src/shared/services/retrieval/types.ts
    - packages/agents/src/shared/services/retrieval/strategies/vector-strategy.ts
    - packages/agents/src/shared/services/retrieval/strategies/keyword-strategy.ts
    - packages/agents/src/shared/services/retrieval/fusion.ts
    - packages/agents/src/shared/services/retrieval/pipeline.ts
    - packages/agents/src/shared/services/retrieval/index.ts
    - packages/agents/src/shared/db/migrations/0021_add_knowledge_fulltext_index.sql
  modified:
    - packages/agents/src/shared/db/schema.drizzle.ts

key-decisions:
  - "Module-level strategies Map populated at import time for getRegisteredStrategyNames() without pipeline instantiation"
  - "Vector strategy passes embeddingService via config bag (config.embeddingService) per StrategyFactory signature"
  - "Keyword strategy uses expression index (no schema column change) for simplicity"
  - "Pipeline injects embeddingService into all strategy configs automatically"

patterns-established:
  - "Strategy pattern with Map<string, StrategyFactory> registration: new strategies via strategies.set() without pipeline modification"
  - "RRF fusion as pure function: rank-based score normalization, score-distribution-agnostic"
  - "Promise.allSettled for parallel strategy execution with graceful degradation on individual failures"

requirements-completed: [KR-01, KR-03, KR-04]

# Metrics
duration: 4min
completed: 2026-02-22
---

# Phase 87 Plan 01: Retrieval Pipeline Summary

**Pluggable retrieval pipeline with vector/keyword strategies, RRF score fusion (k=60), and module-level strategy Map registration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-22T23:52:00Z
- **Completed:** 2026-02-22T23:56:54Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- RetrievalStrategy interface with `search(query, scope, limit)` contract enabling pluggable retrieval approaches
- Vector strategy wrapping existing KnowledgeService cosine distance logic with same SIMILARITY_THRESHOLD (0.3)
- Keyword strategy using PostgreSQL `to_tsvector`/`plainto_tsquery` with `ts_rank` scoring
- RRF fusion function with k=60, weight normalization, and edge case handling (empty/single/zero-weight)
- Pipeline factory running strategies via `Promise.allSettled` with graceful degradation
- GIN expression index migration for keyword search performance

## Task Commits

Each task was committed atomically:

1. **Task 1: Strategy types, vector strategy, keyword strategy, and GIN index migration** - `454c3d8e` (feat)
2. **Task 2: RRF fusion, pipeline factory, and barrel exports** - `a935f385` (feat)

## Files Created/Modified
- `packages/agents/src/shared/services/retrieval/types.ts` - Core type contract: ScoredResult, RetrievalScope, RetrievalStrategy, StrategyFactory, RetrievalConfig
- `packages/agents/src/shared/services/retrieval/strategies/vector-strategy.ts` - Wraps cosine distance search from KnowledgeService
- `packages/agents/src/shared/services/retrieval/strategies/keyword-strategy.ts` - PostgreSQL full-text search with tsvector/tsquery
- `packages/agents/src/shared/services/retrieval/fusion.ts` - reciprocalRankFusion pure function with k=60
- `packages/agents/src/shared/services/retrieval/pipeline.ts` - createRetrievalPipeline factory with strategy Map and allSettled execution
- `packages/agents/src/shared/services/retrieval/index.ts` - Barrel exports for all types, factories, and functions
- `packages/agents/src/shared/db/migrations/0021_add_knowledge_fulltext_index.sql` - GIN expression index on (topic || content)
- `packages/agents/src/shared/db/schema.drizzle.ts` - Added documentation comment for GIN fulltext index

## Decisions Made
- **Module-level strategies Map**: Populated at import time so `getRegisteredStrategyNames()` works without pipeline instantiation (needed for Plan 03 YAML validation)
- **embeddingService in config bag**: Vector strategy receives embeddingService via `config.embeddingService` rather than a separate constructor param, conforming to the `StrategyFactory(db, config)` signature
- **Expression index over generated column**: GIN index on `to_tsvector('english', topic || ' ' || content)` avoids adding a tsvector column to the schema, keeping the migration minimal
- **Pipeline auto-injects embeddingService**: The pipeline factory spreads embeddingService into all strategy configs automatically, so individual YAML strategy blocks don't need to reference it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed strict TypeScript indexing errors in fusion.ts and pipeline.ts**
- **Found during:** Task 2 verification (typecheck)
- **Issue:** Array indexing (`results[rank]`, `settled[i]`) returns `T | undefined` under strict noUncheckedIndexedAccess, causing type errors
- **Fix:** Used type assertion for fusion loop (`as ScoredResult`), refactored pipeline to use `entries()` iterator with explicit undefined guards
- **Files modified:** fusion.ts, pipeline.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** a935f385 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed biome import/export ordering in index.ts**
- **Found during:** Task 2 commit (pre-commit hook)
- **Issue:** Biome organizeImports rule requires exports sorted alphabetically by source module
- **Fix:** Reordered exports to match biome's sorting expectations
- **Files modified:** index.ts
- **Verification:** `biome check` passes
- **Committed in:** a935f385 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs -- strict TypeScript and linting)
**Impact on plan:** Trivial fixes for strict mode compatibility. No scope creep.

## Issues Encountered
- Task 1 commit was picked up by a parallel executor (87-02) resulting in a combined commit with lifecycle-hooks.ts changes. All Plan 01 files are tracked correctly in commit `454c3d8e`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Retrieval pipeline module ready for Plan 02 (pre-compaction flush hook) and Plan 03 (YAML schema extension with agent-registry validation)
- Strategy Map contains "vector" and "keyword" entries, ready for `getRegisteredStrategyNames()` validation
- Pipeline factory ready to be instantiated per-agent in knowledge query tool

## Self-Check: PASSED

All 8 files verified present. Both commit hashes (454c3d8e, a935f385) found in git log.

---
*Phase: 87-knowledge-retrieval-enhancement*
*Completed: 2026-02-22*
