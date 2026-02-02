---
phase: 41-timeout-scheduling
plan: 01
subsystem: agents
tags: [pg-boss, timeout, scheduler, delayed-jobs, postgresql, signals]

# Dependency graph
requires:
  - phase: 40-conversation-executor
    provides: ConversationExecutor with signal() method, worker loop with wait_for handling
provides:
  - TimeoutScheduler factory wrapping pg-boss for delayed signal delivery
  - IDatabase adapter for sharing existing pg.Pool with pg-boss
  - Duration parser for timeout strings (minutes, hours, days)
  - 20 unit tests covering all scheduler methods
affects:
  - 41-02 (executor wiring -- uses TimeoutScheduler to schedule/cancel timeouts)
  - 42-api-layer (scheduler lifecycle management in service bootstrap)

# Tech tracking
tech-stack:
  added: [pg-boss@^12.8.0]
  patterns: [IDatabase adapter for connection pool sharing, vi.hoisted mock pattern for constructor mocking]

key-files:
  created:
    - packages/agents/src/framework/timeout-scheduler.ts
    - packages/agents/src/framework/timeout-scheduler.test.ts
  modified:
    - packages/agents/package.json
    - packages/agents/src/framework/index.ts
    - pnpm-lock.yaml

key-decisions:
  - "pg-boss PgBoss class is a named export (not default) in v12.8.0 -- import as { PgBoss }"
  - "cancel() requires queue name + job ID (not just ID) per pg-boss v12 API"
  - "IDatabase adapter returns rowCount for convenience but pg-boss only requires { rows } in interface"
  - "Duration parser supports 'm' (minutes) in addition to 'h' and 'd' for testing convenience"

patterns-established:
  - "vi.hoisted() for mock variables referenced in vi.mock() factory -- required by Vitest v4 hoisting"
  - "Function constructor in vi.fn() for mocking classes used with new keyword"
  - "createSchedulerOptions() helper centralizes unknown-cast pattern for test readability"

# Metrics
duration: 8min
completed: 2026-02-02
---

# Phase 41 Plan 01: TimeoutScheduler Service Summary

**pg-boss TimeoutScheduler with IDatabase pool adapter, duration parser, and 20 unit tests for durable delayed signal delivery**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-02T20:09:03Z
- **Completed:** 2026-02-02T20:16:57Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments
- TimeoutScheduler factory with start/schedule/cancel/close methods wrapping pg-boss
- IDatabase adapter shares existing pg.Pool with pg-boss (no second connection pool)
- Duration parser handles minutes (m), hours (h), and days (d) timeout strings
- Worker handler delivers wait_timeout signal via executor.signal() with deduplication ID
- 20 comprehensive unit tests covering all methods and edge cases
- Full test suite at 1195 tests (up from 1175), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pg-boss and create TimeoutScheduler service** - `8b584f3` (feat)
2. **Task 2: Unit tests for TimeoutScheduler** - `f579033` (test)

## Files Created/Modified
- `packages/agents/src/framework/timeout-scheduler.ts` - TimeoutScheduler factory, IDatabase adapter, duration parser
- `packages/agents/src/framework/timeout-scheduler.test.ts` - 20 unit tests for all scheduler methods
- `packages/agents/src/framework/index.ts` - Added TimeoutScheduler exports to barrel
- `packages/agents/package.json` - Added pg-boss dependency
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made
- pg-boss PgBoss class is a named export (not default) in v12.8.0 -- import as `{ PgBoss }` not `default`
- `cancel()` requires queue name + job ID per pg-boss v12 API -- research noted this as just job ID which was incorrect
- Duration parser supports minutes ('m') for testing convenience beyond the originally planned hours/days
- Used `vi.hoisted()` for mock variables referenced in `vi.mock()` factory -- Vitest v4 requirement

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pg-boss import style**
- **Found during:** Task 1 (TimeoutScheduler creation)
- **Issue:** Plan specified `import PgBoss from "pg-boss"` (default import), but pg-boss v12.8.0 exports PgBoss as a named export
- **Fix:** Changed to `import { PgBoss } from "pg-boss"` and `import type { Job } from "pg-boss"`
- **Files modified:** packages/agents/src/framework/timeout-scheduler.ts
- **Verification:** `pnpm --filter @aesir/agents typecheck` passes
- **Committed in:** 8b584f3 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed pg-boss cancel() API signature**
- **Found during:** Task 1 (TimeoutScheduler creation)
- **Issue:** Research noted cancel signature as `cancel(id)` but pg-boss v12 types show `cancel(name, id)`
- **Fix:** Updated cancel() to pass both queue name and job ID: `boss.cancel(TIMEOUT_QUEUE, jobId)`
- **Files modified:** packages/agents/src/framework/timeout-scheduler.ts
- **Verification:** TypeScript compilation passes, cancel test verifies both arguments
- **Committed in:** 8b584f3 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs from incorrect research assumptions)
**Impact on plan:** Both fixes were necessary for correct API usage. No scope creep.

## Issues Encountered
- Vitest v4 `vi.fn().mockImplementation(() => obj)` does not work as a constructor -- required `vi.hoisted()` with function constructor pattern
- Biome linting requires `as unknown as Type` pattern instead of `as any`, and strict import ordering with type exports before value exports

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- TimeoutScheduler service is complete and tested
- Ready for Plan 02: wiring into executor and worker loop
- Plan 02 will call `schedule()` when conversations pause with timeout, `cancel()` when signals resume, and `start()` during worker bootstrap

---
*Phase: 41-timeout-scheduling*
*Completed: 2026-02-02*
