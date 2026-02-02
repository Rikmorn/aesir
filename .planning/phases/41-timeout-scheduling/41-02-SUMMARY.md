---
phase: 41-timeout-scheduling
plan: 02
subsystem: agents
tags: [timeout, executor, worker-loop, signals, pg-boss, wiring]

# Dependency graph
requires:
  - phase: 41-timeout-scheduling
    provides: TimeoutScheduler service with schedule/cancel/start/close methods (Plan 01)
  - phase: 40-conversation-executor
    provides: ConversationExecutor with signal/cancel methods, WorkerLoop with wait_for handling
provides:
  - Timeout scheduling on conversation pause (worker loop schedules pg-boss job)
  - Timeout cancellation on signal resume and conversation cancel (executor)
  - TimeoutScheduler lifecycle management in executor startWorker/stopWorker
  - timeoutJobId stored in pending_wait JSONB for cancellation lookup
  - 12 new tests covering all timeout wiring paths
affects:
  - 42-api-layer (executor bootstrap passes timeoutScheduler option)

# Tech tracking
tech-stack:
  added: []
  patterns: [named executor variable for closure access in factory pattern]

key-files:
  created: []
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/worker-loop.test.ts
    - packages/agents/src/framework/conversation-executor.test.ts

key-decisions:
  - "Refactored executor factory to named const variable (not bare return) for closure access from startWorker"
  - "Timeout scheduling failure is non-fatal -- conversation still pauses without timeout"
  - "timeoutJobId stored in pending_wait JSONB alongside wait metadata for simple cancellation lookup"
  - "TimeoutScheduler.start() called fire-and-forget with void + catch in synchronous startWorker()"

patterns-established:
  - "Named executor variable pattern: const executor: T = { ... }; return executor; -- enables self-reference in method closures"
  - "timeoutJobId in pending_wait JSONB: optional field for cancellation lookup, absent when no timeout scheduled"

# Metrics
duration: 4min
completed: 2026-02-02
---

# Phase 41 Plan 02: Executor Wiring Summary

**TimeoutScheduler wired into worker loop (schedule on pause) and executor (cancel on resume/cancel, lifecycle start/stop) with 12 new tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-02T20:20:41Z
- **Completed:** 2026-02-02T20:24:51Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments
- Worker loop schedules pg-boss timeout job when conversation pauses with timeout duration
- Executor cancels pending timeout when signal resumes a waiting conversation
- Executor cancels pending timeout when conversation is cancelled while waiting
- TimeoutScheduler lifecycle managed via startWorker()/stopWorker()
- pending_wait JSONB stores timeoutJobId for cancellation lookup
- 12 new tests across worker-loop and conversation-executor test files
- Full test suite at 1207 tests (up from 1195), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire TimeoutScheduler into types, executor, and worker loop** - `dc492b1` (feat)
2. **Task 2: Tests for timeout wiring in executor and worker loop** - `cc790ef` (test)

## Files Created/Modified
- `packages/agents/src/framework/types.ts` - Added optional timeoutScheduler to ConversationExecutorOptions
- `packages/agents/src/framework/worker-loop.ts` - Schedule timeout after wait_for pause, timeoutJobId in pending_wait
- `packages/agents/src/framework/conversation-executor.ts` - Cancel timeout on signal/cancel, start/stop scheduler lifecycle, refactored to named executor variable
- `packages/agents/src/framework/worker-loop.test.ts` - 4 new timeout scheduling tests
- `packages/agents/src/framework/conversation-executor.test.ts` - 8 new timeout cancellation and lifecycle tests

## Decisions Made
- Refactored executor factory from bare `return { ... }` to `const executor: ConversationExecutor = { ... }; return executor;` -- enables closure access from startWorker() which needs to pass `executor` to `timeoutScheduler.start(executor)`
- Timeout scheduling failure is non-fatal: conversation still transitions to "waiting" without a timeout job if scheduling fails
- timeoutJobId is an optional field in pending_wait JSONB: only present when a timeout was successfully scheduled
- TimeoutScheduler.start() called as fire-and-forget (`void ... .catch()`) from synchronous startWorker() to avoid changing the interface to async

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome linting required specific import ordering: `TimeoutScheduler` import from `./timeout-scheduler.js` must come after `../shared/db/schema.js` imports. Fixed before commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 41 (Timeout Scheduling) is complete
- TMO-01: Worker loop schedules timeout after wait_for pause with duration
- TMO-02: Executor cancel() cancels pending timeout
- TMO-03: Executor signal() cancels pending timeout before resuming; timeout fires via executor.signal() (same pathway)
- Ready for Phase 42: API layer that bootstraps the executor with timeoutScheduler option

---
*Phase: 41-timeout-scheduling*
*Completed: 2026-02-02*
