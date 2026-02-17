---
phase: 78-work-correlation
plan: 05
subsystem: agents
tags: [correlation, executor, worker-loop, lifecycle, work-correlation, fire-and-forget]

# Dependency graph
requires:
  - phase: 78-01
    provides: work_correlations table, CorrelationStatus type, WorkCorrelation exports
  - phase: 78-03
    provides: CorrelationService factory with register, updateStatus methods
provides:
  - Auto-registration of entity correlation at executor.start() when entityRef is provided
  - Correlation status propagation at all worker loop lifecycle boundaries (active, waiting, completed, failed)
  - CorrelationService bootstrapped and injected into executor, worker loop, tool registration, and route event deps
  - entityRef field on StartConversationParams for router-provided entity references
  - correlationService field on ConversationExecutorOptions and WorkerLoopOptions
  - correlationService field on RouteEventDeps (for Plan 06)
affects: [78-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget status propagation: void + .catch() pattern for non-blocking, non-fatal secondary operations"
    - "entityRef as optional parameter on StartConversationParams -- only router sets it, sub-agent spawns skip it"

key-files:
  created: []
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/router/types.ts

key-decisions:
  - "Registration is best-effort (try/catch with warn log) -- correlation is secondary to conversation lifecycle"
  - "Fire-and-forget pattern (void + catch) for all status propagation -- matches existing eventLog.append() pattern"
  - "correlationService added to RouteEventDeps proactively for Plan 06 correlation routing"
  - "CorrelationService import removed from conversation-executor.ts -- type inferred from options destructuring"

patterns-established:
  - "Correlation status lifecycle: active (claimed) -> waiting (wait_for) -> active (resumed) -> completed/failed (terminal)"

requirements-completed: [CORR-02, CORR-05]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 78 Plan 05: Executor and Worker Loop Correlation Wiring Summary

**Auto-registration of entity correlations at executor.start() with fire-and-forget status propagation at all worker loop lifecycle boundaries (active, waiting, completed, failed)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T23:22:18Z
- **Completed:** 2026-02-17T23:27:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added optional `entityRef` field to `StartConversationParams` for router-provided entity correlation
- Auto-registration in `executor.start()` for both new conversations and re-triggered conversations (terminal state path), with idempotent skip for existing active conversations
- Status propagation at 5 lifecycle boundaries in worker loop: active (claim), waiting (wait_for), completed, failed (non-retryable), and failed (unhandled error)
- All correlation operations are fire-and-forget (non-blocking) and best-effort (non-fatal on failure)
- CorrelationService injected into executor, worker loop, tool registration, and route event deps in main.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Add entityRef to StartConversationParams and auto-register in executor.start()** - `954112f` (feat)
2. **Task 2: Add status propagation to worker loop and bootstrap in main.ts** - `2a11486` (feat)

## Files Created/Modified
- `packages/agents/src/framework/types.ts` - Added entityRef to StartConversationParams, correlationService to ConversationExecutorOptions, CorrelationService import
- `packages/agents/src/framework/conversation-executor.ts` - Auto-registration at start() for new and re-triggered conversations, correlationService passthrough to worker loop
- `packages/agents/src/framework/worker-loop.ts` - correlationService in WorkerLoopOptions, status propagation at 5 lifecycle boundaries (active, waiting, completed, failed x2)
- `packages/agents/src/service/main.ts` - correlationService passed to executor and route event deps
- `packages/agents/src/router/types.ts` - correlationService added to RouteEventDeps for Plan 06

## Decisions Made
- **Best-effort registration:** Auto-registration failures are logged at warn level and do not affect conversation creation. Correlation is a secondary concern that must never block the primary conversation lifecycle.
- **Fire-and-forget pattern:** All correlation status updates use `void promise.catch()` -- the same pattern used by existing eventLog.append() calls. This ensures status propagation never blocks agent execution.
- **Proactive RouteEventDeps wiring:** Added correlationService to RouteEventDeps now (Plan 05) even though Plan 06 will consume it. This avoids main.ts merge conflicts when Plan 06 executes.
- **CorrelationService import removed from executor:** The type is inferred from the ConversationExecutorOptions destructuring, so the explicit import was flagged as unused by Biome.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added correlationService to WorkerLoopOptions**
- **Found during:** Task 1 (conversation-executor.ts changes)
- **Issue:** Task 1 passes `correlationService` from executor options to worker loop options, but `WorkerLoopOptions` did not yet have the field (Task 2 scope). TypeScript error blocked Task 1 verification.
- **Fix:** Added `correlationService?: CorrelationService | undefined` to `WorkerLoopOptions` in worker-loop.ts as part of Task 1 commit.
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** 954112f (Task 1 commit)

**2. [Rule 1 - Bug] Removed unused CorrelationService import**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** Explicit `import type { CorrelationService }` in conversation-executor.ts was unused -- the type is inferred from the options destructuring.
- **Fix:** Removed the explicit import
- **Files modified:** packages/agents/src/framework/conversation-executor.ts
- **Verification:** Biome lint passes
- **Committed in:** 954112f (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for typecheck and lint compliance. No scope creep.

## Issues Encountered
- Biome formatting required chained `.updateStatus().catch()` calls on a single line for the shorter expressions but allowed multi-line for longer ones. Resolved by running `pnpm run lint:fix` to auto-format.

## User Setup Required
None - no external service configuration required. Existing CorrelationService from Plan 03 is reused.

## Next Phase Readiness
- All correlation infrastructure wired: service, tools, auto-registration, status propagation
- Plan 06 (correlation routing) has correlationService available in RouteEventDeps
- entityRef on StartConversationParams ready for router to populate from IncomingEvent.entityRef

## Self-Check: PASSED

- All 5 modified files verified on disk
- Both commit hashes (954112f, 2a11486) found in git log

---
*Phase: 78-work-correlation*
*Completed: 2026-02-17*
