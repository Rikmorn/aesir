---
phase: 68-shared-memory
plan: 04
subsystem: agents, knowledge
tags: [knowledge-update, supersede, invalidate, cleanup, setInterval, lifecycle]

# Dependency graph
requires:
  - "68-03: KnowledgeService with store, query, supersede, invalidate, cleanupExpired methods"
provides:
  - knowledge:update tool factory with supersede and invalidate actions
  - Hourly background cleanup job for expired knowledge entries (24h grace period)
  - Complete knowledge lifecycle (store, query, update, cleanup) with 42 tools registered
affects: [69-entity-directory, agent-definitions]

# Tech tracking
tech-stack:
  added: []
  patterns: [knowledge-update-tool-factory, interval-based-cleanup-with-unref]

key-files:
  created:
    - packages/agents/src/shared/tools/knowledge/update.ts
  modified:
    - packages/agents/src/shared/tools/knowledge/index.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/service/main.ts

key-decisions:
  - "setInterval over pg-boss cron for cleanup (TimeoutScheduler doesn't expose boss instance, single-process deployment)"
  - "Cleanup as first shutdown step (stop generating new work before draining existing)"

patterns-established:
  - "Knowledge update tool: discriminated union on action field (supersede vs invalidate)"
  - "Cleanup timer with unref() and clearInterval in graceful shutdown"

# Metrics
duration: 3min
completed: 2026-02-10
---

# Phase 68 Plan 04: Knowledge Update Tool & Cleanup Summary

**knowledge:update tool with supersede/invalidate actions and hourly background cleanup of entries expired 24h+ ago, completing the knowledge lifecycle at 42 registered tools**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T19:18:22Z
- **Completed:** 2026-02-10T19:21:13Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- knowledge:update tool factory with discriminated action schema (supersede creates replacement, invalidate marks as invalid)
- Hourly background cleanup via setInterval with 24h grace period after expiry for debugging
- Complete knowledge lifecycle: store, query, update (supersede/invalidate), automatic cleanup
- All 42 tools registered in framework (39 prior + 3 knowledge: store, query, update)

## Task Commits

Each task was committed atomically:

1. **Task 1: knowledge:update tool and tool registration** - `1c95084` (feat)
2. **Task 2: Background expiry cleanup via setInterval** - `1da884a` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/knowledge/update.ts` - knowledge:update tool factory with supersede and invalidate actions
- `packages/agents/src/shared/tools/knowledge/index.ts` - Added createKnowledgeUpdateTool export
- `packages/agents/src/framework/tool-factories.ts` - Registered knowledge:update as 42nd tool
- `packages/agents/src/framework/tool-factories.test.ts` - Updated tests for 42-tool count and knowledge:update
- `packages/agents/src/service/main.ts` - Hourly knowledge cleanup timer with graceful shutdown

## Decisions Made
- Used setInterval instead of pg-boss cron for cleanup because TimeoutScheduler does not expose its pg-boss instance and modifying it would be an unnecessary interface change for a single-process deployment
- Cleanup timer is first item cleared during graceful shutdown (stop generating new work before draining existing conversations)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated tool-factories test expectations for 42 tools**
- **Found during:** Task 1 (tool registration)
- **Issue:** Existing tests expected 41 tools and only checked knowledge:store and knowledge:query
- **Fix:** Updated count to 42, added knowledge:update to knowledge tools test, updated log assertion
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** All 20 tests pass
- **Committed in:** 1c95084 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test expectation update was necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Knowledge lifecycle is complete: agents can store, query, supersede, invalidate, and entries are auto-cleaned
- Phase 68 (Shared Memory) is fully complete -- all 4 plans shipped
- Ready for Phase 69 (Entity Directory) which uses pgvector for semantic capability matching

## Self-Check: PASSED

- [x] packages/agents/src/shared/tools/knowledge/update.ts - FOUND
- [x] packages/agents/src/shared/tools/knowledge/index.ts - FOUND (createKnowledgeUpdateTool exported)
- [x] packages/agents/src/framework/tool-factories.ts - FOUND (knowledge:update registered)
- [x] packages/agents/src/service/main.ts - FOUND (knowledgeCleanupTimer, clearInterval)
- [x] Commit 1c95084 - FOUND
- [x] Commit 1da884a - FOUND

---
*Phase: 68-shared-memory*
*Completed: 2026-02-10*
