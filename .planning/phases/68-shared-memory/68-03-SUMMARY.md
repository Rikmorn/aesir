---
phase: 68-shared-memory
plan: 03
subsystem: agents, knowledge
tags: [pgvector, semantic-search, knowledge-service, drizzle, cosine-similarity, embedding]

# Dependency graph
requires:
  - "68-01: knowledge_entries table with pgvector, Drizzle schema, embedding env config"
  - "68-02: EmbeddingService interface with Ollama and Voyage AI providers"
provides:
  - KnowledgeService factory with store, query, supersede, invalidate, cleanupExpired methods
  - knowledge:store tool factory for agents to persist classified knowledge
  - knowledge:query tool factory for semantic search across shared knowledge
  - Framework registration (41 tools total) and bootstrap wiring in main.ts
affects: [68-04-knowledge-tools-advanced, 69-entity-directory, agent-definitions]

# Tech tracking
tech-stack:
  added: []
  patterns: [knowledge-service-factory, knowledge-tool-factories, cosine-similarity-query-with-drizzle]

key-files:
  created:
    - packages/agents/src/shared/services/knowledge-service.ts
    - packages/agents/src/shared/tools/knowledge/types.ts
    - packages/agents/src/shared/tools/knowledge/store.ts
    - packages/agents/src/shared/tools/knowledge/query.ts
    - packages/agents/src/shared/tools/knowledge/index.ts
  modified:
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/shared/embedding/types.ts

key-decisions:
  - "cosineDistance from drizzle-orm for pgvector similarity queries (1 - cosineDistance = similarity score)"
  - "Scope visibility as SQL condition (not application-level filtering) for row-level security"
  - "EmbeddingConfig.voyage.apiKey changed from optional property to explicit string|undefined for exactOptionalPropertyTypes compatibility"

patterns-established:
  - "Knowledge tool pattern: tool factory takes (KnowledgeService, ToolContext), extracts agentId from ctx"
  - "Graceful degradation in query tool: catch-all returns empty results, never crashes (MEM-08)"
  - "Deduplication on store: same type+topic auto-supersedes existing active entry"

# Metrics
duration: 6min
completed: 2026-02-10
---

# Phase 68 Plan 03: Knowledge Service & Tools Summary

**KnowledgeService with pgvector cosine similarity search, deduplication, scope-based visibility, and knowledge:store/knowledge:query tools registered as 41st/42nd framework tools**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-10T19:09:52Z
- **Completed:** 2026-02-10T19:15:55Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- KnowledgeService factory with store (Zod validation, topic normalization, scope defaults, type-based expiry, deduplication), query (cosine similarity with threshold, structured fallback, scope visibility), supersede, invalidate, and cleanupExpired
- knowledge:store and knowledge:query tool factories following create-task pattern, with author extracted from ToolContext
- Framework registration (39 -> 41 tools, new knowledge namespace) and bootstrap wiring (EmbeddingService -> KnowledgeService -> registerAllTools)
- Updated tool-factories tests (20 tests passing) with knowledge namespace and 41-tool count

## Task Commits

Each task was committed atomically:

1. **Task 1: KnowledgeService factory** - `9a87b35` (feat)
2. **Task 2: Knowledge tools and framework registration** - `8bf5563` (feat)

## Files Created/Modified
- `packages/agents/src/shared/services/knowledge-service.ts` - KnowledgeService factory with store, query, supersede, invalidate, cleanupExpired
- `packages/agents/src/shared/tools/knowledge/types.ts` - KNOWLEDGE_TYPES constant and KnowledgeType
- `packages/agents/src/shared/tools/knowledge/store.ts` - knowledge:store tool factory
- `packages/agents/src/shared/tools/knowledge/query.ts` - knowledge:query tool factory with graceful degradation
- `packages/agents/src/shared/tools/knowledge/index.ts` - Barrel export
- `packages/agents/src/framework/tool-factories.ts` - Added knowledge:store and knowledge:query registration (41 tools)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated tests for 41 tools and knowledge namespace
- `packages/agents/src/service/main.ts` - Bootstrap EmbeddingService and KnowledgeService
- `packages/agents/src/shared/embedding/types.ts` - Fixed voyage.apiKey type for exactOptionalPropertyTypes

## Decisions Made
- Used `cosineDistance` from drizzle-orm for pgvector similarity queries, computing similarity as `1 - cosineDistance(embedding, queryEmbedding)` with 0.3 threshold
- Scope visibility implemented as SQL condition `(scope = 'shared' OR (scope = 'private' AND author = agentId))` rather than application-level filtering, for row-level security
- Changed `EmbeddingConfig.voyage.apiKey` from `apiKey?: string` (optional property) to `apiKey: string | undefined` (explicit undefined) to satisfy `exactOptionalPropertyTypes: true` in tsconfig -- the config object always has the property present, just sometimes undefined

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EmbeddingConfig type incompatibility with exactOptionalPropertyTypes**
- **Found during:** Task 2 (framework registration)
- **Issue:** `config.embedding.voyage.apiKey` (from `as const` object) has type `string | undefined` (property always present), but `EmbeddingConfig.voyage.apiKey?: string` is an optional property. With `exactOptionalPropertyTypes: true` these are incompatible.
- **Fix:** Changed `apiKey?: string` to `apiKey: string | undefined` in EmbeddingConfig
- **Files modified:** packages/agents/src/shared/embedding/types.ts
- **Verification:** typecheck passes, Voyage provider already handles undefined via `if (!config.voyage.apiKey)` guard
- **Committed in:** 8bf5563 (Task 2 commit)

**2. [Rule 1 - Bug] Updated tool-factories test expectations for new tool count**
- **Found during:** Task 2 (framework registration)
- **Issue:** Existing tests expected 39 tools and didn't include knowledge namespace
- **Fix:** Updated count to 41, added knowledge namespace to expected namespaces set, added knowledge tools test
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** All 20 tests pass
- **Committed in:** 8bf5563 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for type safety and test correctness. No scope creep.

## Issues Encountered
- Biome pre-commit hook caught formatting (tabs vs spaces) and import ordering issues on both commits -- fixed with `pnpm run lint:fix && pnpm run format` and re-staged.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- KnowledgeService and tools ready for Plan 68-04 (advanced tools: supersede, invalidate, update)
- Agents can now store and query knowledge once their definition.yaml includes `knowledge:store` and `knowledge:query`
- No agent definitions updated yet -- that happens when agents are configured to use knowledge tools

## Self-Check: PASSED

- [x] packages/agents/src/shared/services/knowledge-service.ts - FOUND
- [x] packages/agents/src/shared/tools/knowledge/types.ts - FOUND
- [x] packages/agents/src/shared/tools/knowledge/store.ts - FOUND
- [x] packages/agents/src/shared/tools/knowledge/query.ts - FOUND
- [x] packages/agents/src/shared/tools/knowledge/index.ts - FOUND
- [x] packages/agents/src/framework/tool-factories.ts - FOUND (knowledge:store, knowledge:query registered)
- [x] packages/agents/src/service/main.ts - FOUND (createEmbeddingService, createKnowledgeService)
- [x] Commit 9a87b35 - FOUND
- [x] Commit 8bf5563 - FOUND

---
*Phase: 68-shared-memory*
*Completed: 2026-02-10*
