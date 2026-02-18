---
phase: 78-work-correlation
plan: 03
subsystem: agents
tags: [drizzle, zod, correlation, tools, work-correlation, factory-pattern]

# Dependency graph
requires:
  - phase: 78-01
    provides: work_correlations table, correlationStatusValues enum, WorkCorrelation type exports
provides:
  - CorrelationService factory with register, queryActive, queryTerminal, queryAll, updateStatus, health, close
  - work:register agent tool for entity correlation registration
  - work:query agent tool for entity correlation lookup
  - Work tools barrel export (work/index.ts)
  - CorrelationService wired into RegisterAllToolsOptions and main.ts bootstrap
affects: [78-04, 78-05, 78-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CorrelationService follows KnowledgeService factory pattern: options object, child logger, Drizzle ORM queries"
    - "ON CONFLICT upsert for register (re-activates existing correlations on same entity+conversation)"
    - "CorrelationStatus type import for type-safe status transitions in updateStatus"

key-files:
  created:
    - packages/agents/src/shared/services/correlation-service.ts
    - packages/agents/src/shared/tools/work/register.ts
    - packages/agents/src/shared/tools/work/query.ts
    - packages/agents/src/shared/tools/work/index.ts
  modified:
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/service/main.ts

key-decisions:
  - "CorrelationStatus type used for updateStatus parameter instead of string -- type-safe status transitions"
  - "Parallel executor committed work tool files in 78-04 docs commit -- format/lint fixes applied in separate 78-03 commit"

patterns-established:
  - "Work tool pattern: Zod enum validation for entityType, service delegation for DB operations"

requirements-completed: [CORR-03, CORR-04]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 78 Plan 03: Correlation Service and Work Tools Summary

**CorrelationService factory with Drizzle ORM upserts plus work:register and work:query agent tools wired into ToolRegistry (47 -> 49 tools)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T23:13:28Z
- **Completed:** 2026-02-17T23:19:23Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created CorrelationService factory with 7 methods (register, queryActive, queryTerminal, queryAll, updateStatus, health, close) following the KnowledgeService pattern
- Created work:register tool that validates entityType enum and entityId via Zod, then calls CorrelationService.register with conversationId and agentId from ToolContext
- Created work:query tool that returns all correlations for an entity formatted as structured text with status, agentId, and conversationId
- Wired CorrelationService as required dependency in RegisterAllToolsOptions and main.ts bootstrap; registered both tools under "work" namespace in ToolRegistry
- Updated test suite: 47 -> 49 tools, "work" namespace added, mock CorrelationService provided

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CorrelationService factory** - `2e0c0ba` (feat)
2. **Task 2: Create work:register and work:query tools, wire into ToolRegistry** - `c92cdae` (feat)

## Files Created/Modified
- `packages/agents/src/shared/services/correlation-service.ts` - CorrelationService factory with register (ON CONFLICT upsert), queryActive (active/waiting), queryTerminal (completed/failed, excludes superseded), queryAll, updateStatus, health, close
- `packages/agents/src/shared/tools/work/register.ts` - work_register tool factory: Zod-validated entityType enum + entityId, delegates to CorrelationService.register
- `packages/agents/src/shared/tools/work/query.ts` - work_query tool factory: Zod-validated input, returns structured text of all correlations for an entity
- `packages/agents/src/shared/tools/work/index.ts` - Barrel export for work tool factories
- `packages/agents/src/framework/tool-factories.ts` - Added CorrelationService import, correlationService option, work:register and work:query registration (49 tools, 10 categories)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated counts (49), added work namespace, mock CorrelationService, work tool registration test
- `packages/agents/src/service/main.ts` - Creates CorrelationService and passes to registerAllTools

## Decisions Made
- **CorrelationStatus type for updateStatus:** Plan specified `string` for the status parameter, but Drizzle's column type requires the enum. Used `CorrelationStatus` type import from schema for type safety.
- **queryTerminal excludes superseded:** Per CONTEXT.md, superseded status is treated as "no active correlation" and is not included in terminal query results either. Only completed/failed are terminal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed updateStatus type mismatch**
- **Found during:** Task 1 (CorrelationService factory)
- **Issue:** Plan specified `status: string` parameter for updateStatus, but Drizzle column uses typed enum (`correlationStatusValues`). TypeScript error: string not assignable to enum type.
- **Fix:** Changed parameter type to `CorrelationStatus` (imported from schema.ts)
- **Files modified:** packages/agents/src/shared/services/correlation-service.ts
- **Verification:** `pnpm --filter @aesir/agents typecheck` passes
- **Committed in:** 2e0c0ba (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Trivial type correction for Drizzle compatibility. No scope creep.

## Issues Encountered
- Parallel 78-04 executor committed work tool files (register.ts, query.ts, index.ts) alongside its own docs commit because `git add` picked up unstaged files from the shared working tree. The 78-03 Task 2 commit then applied format/lint fixes to those files. This is a known parallel execution edge case.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CorrelationService ready for Plans 04-06 (correlation routing, knowledge metadata, lifecycle hooks)
- work:register and work:query tools available for agent definitions to reference
- RegisterAllToolsOptions requires correlationService -- all callers (main.ts) updated

## Self-Check: PASSED

- All 4 created files verified on disk
- Both commit hashes (2e0c0ba, c92cdae) found in git log

---
*Phase: 78-work-correlation*
*Completed: 2026-02-17*
