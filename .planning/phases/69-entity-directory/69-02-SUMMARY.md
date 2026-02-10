---
phase: 69-entity-directory
plan: 02
subsystem: agents
tags: [pgvector, cosine-similarity, directory, semantic-search, drizzle-orm]

# Dependency graph
requires:
  - phase: 69-01
    provides: entity_directory table with HNSW index and capabilities_embedding column
  - phase: 68
    provides: EmbeddingService for vector generation
provides:
  - DirectoryService factory (find, get, upsert, deactivateStale, health, close)
  - directory:find tool (semantic capability search with self-exclusion)
  - directory:get tool (full entity details by ID)
  - ToolRegistry expanded to 44 tools with directory namespace
  - DirectoryService wired into main.ts bootstrap
affects: [69-03, 70-task-delegation, agent-definitions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DirectoryService follows createService factory pattern (options, fail-fast, interface)
    - Directory tools follow knowledge tool pattern (Zod input, graceful degradation)

key-files:
  created:
    - packages/agents/src/shared/services/directory-service.ts
    - packages/agents/src/shared/tools/directory/find.ts
    - packages/agents/src/shared/tools/directory/get.ts
    - packages/agents/src/shared/tools/directory/index.ts
  modified:
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/service/main.ts

key-decisions:
  - "ne() for self-exclusion instead of raw SQL (consistent with drizzle-orm operator usage)"
  - "directory_get does not take ToolContext (no ctx.agentId needed, unlike find)"

patterns-established:
  - "Directory tools: find uses ToolContext for self-exclusion, get is context-free"

# Metrics
duration: 6min
completed: 2026-02-10
---

# Phase 69 Plan 02: Entity Directory Service Summary

**DirectoryService with pgvector semantic capability matching, directory:find and directory:get tools registered in ToolRegistry (44 tools)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-10T20:32:13Z
- **Completed:** 2026-02-10T20:38:16Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- DirectoryService factory with semantic search (cosine similarity), self-exclusion, graceful degradation on embedding failure
- directory:find and directory:get tools following established knowledge tool patterns
- Full runtime wiring: tool registration (44 total), main.ts bootstrap, DI injection
- Test suite updated: 21 tests passing with directory namespace and tool count assertions

## Task Commits

Each task was committed atomically:

1. **Task 1: DirectoryService factory** - `ef250a8` (feat)
2. **Task 2: Directory tools and runtime registration** - `1c8a673` (feat)

## Files Created/Modified
- `packages/agents/src/shared/services/directory-service.ts` - DirectoryService factory with find, get, upsert, deactivateStale, health, close
- `packages/agents/src/shared/tools/directory/find.ts` - directory_find tool: semantic capability search with self-exclusion
- `packages/agents/src/shared/tools/directory/get.ts` - directory_get tool: full entity details by ID
- `packages/agents/src/shared/tools/directory/index.ts` - Barrel export for directory tools
- `packages/agents/src/framework/tool-factories.ts` - Added directory:find and directory:get registration (42 -> 44 tools)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated test counts, namespaces, and added directory tool assertions
- `packages/agents/src/service/main.ts` - DirectoryService creation and injection into registerAllTools

## Decisions Made
- Used `ne()` from drizzle-orm for self-exclusion (consistent operator style) rather than raw SQL
- `directory_get` does not receive ToolContext since it doesn't need agentId for self-exclusion; only `directory_find` uses ctx

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated tool-factories.test.ts for new directory tools**
- **Found during:** Task 2 (Directory tools and runtime registration)
- **Issue:** Adding directoryService to RegisterAllToolsOptions broke the existing test file which didn't include the new required parameter
- **Fix:** Added mock DirectoryService, updated setupRegistry(), added directory namespace to expected namespaces, updated tool count from 42 to 44, added directory tools test section, updated logging assertion
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** All 21 tests pass
- **Committed in:** 1c8a673 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test update was necessary for correctness. No scope creep.

## Issues Encountered
- Parallel 69-03 executor had staged files in the shared working tree; Task 2 commit included seed-directory.ts from Plan 03. Both plans needed these changes and pre-commit hooks passed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DirectoryService and tools are wired and ready for agents with `directory:find` and `directory:get` in their YAML definitions
- Plan 03 (seed script) can now use DirectoryService.upsert() and DirectoryService.deactivateStale()
- Entity directory schema (Plan 01) + service (Plan 02) + seeding (Plan 03) complete the full entity directory feature

## Self-Check: PASSED

- All 5 created/modified files verified on disk
- Both commits (ef250a8, 1c8a673) verified in git history
- Typecheck passes clean
- All 21 tool-factories tests pass

---
*Phase: 69-entity-directory*
*Completed: 2026-02-10*
