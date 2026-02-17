---
phase: 76-runtime-resilience
plan: 02
subsystem: agents
tags: [failure-notification, graceful-shutdown, drain-timeout, denormalizer, worker-loop]

# Dependency graph
requires:
  - phase: 76-01
    provides: notification.failed event type in schema, MCP error classification
provides:
  - Channel-agnostic failure notifications via denormalizer at all 5 terminal failure paths
  - Drain timeout enforcement in worker loop with abort signaling
  - Health endpoint draining status (503) during shutdown
  - notifyFailure() function replacing Linear-only emitErrorActivity()
  - isDraining() method on WorkerLoop interface
affects: [76-runtime-resilience, dashboard, observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Failure notification via denormalizer (channel-agnostic, not integration-specific)"
    - "Drain timeout with AbortController abort for in-flight conversations"
    - "notification.failed event as backstop when delivery fails"

key-files:
  created: []
  modified:
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/conversation-executor.ts

key-decisions:
  - "notifyFailure replaces emitErrorActivity entirely (not additive) -- removes Linear-only path"
  - "Drain timeout aborts via AbortController; aborted conversations re-enqueue naturally"
  - "pg-boss stopped before drain wait to prevent new timeout jobs during shutdown"
  - "Health endpoint returns 503 with activeClaims count during drain"

patterns-established:
  - "Failure notification pattern: buildFailureMessage + notifyFailure + notification.failed backstop"
  - "Drain timeout pattern: race waitForFinish against deadline, abort on timeout"

requirements-completed: [RESIL-01, RESIL-02, RESIL-03, RESIL-10]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 76 Plan 02: Failure Notification and Graceful Shutdown Summary

**Channel-agnostic failure notifications via denormalizer at all 5 terminal failure paths, drain timeout with abort signaling, and health endpoint draining status**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T00:07:01Z
- **Completed:** 2026-02-17T00:12:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced Linear-only emitErrorActivity with channel-agnostic notifyFailure using the existing denormalizer, covering Slack, Linear, and GitHub
- Wired notifyFailure at all 5 terminal failure paths: stale heartbeat exhausted, agent definition not found (x2), non-retryable loop result, unexpected exception exhausted
- Added drain timeout to worker loop with AbortController-based abort for in-flight conversations when deadline expires
- Health endpoint returns 503 + `{ status: "draining", inFlight: N }` during shutdown for load balancer awareness

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace emitErrorActivity with channel-agnostic notifyFailure** - `79ca48d` (feat)
2. **Task 2: Graceful shutdown with drain timeout and health endpoint draining status** - `fa94f07` (feat)

## Files Created/Modified

- `packages/agents/src/framework/worker-loop.ts` - Added buildFailureMessage(), notifyFailure(), isDraining(), drain timeout logic; removed emitErrorActivity()
- `packages/agents/src/service/main.ts` - Health endpoint draining status (503), drain timeout calculation, pg-boss stop before drain
- `packages/agents/src/framework/types.ts` - Updated ConversationExecutor.stopWorker() signature to accept optional timeoutMs
- `packages/agents/src/framework/conversation-executor.ts` - Thread timeoutMs from stopWorker to workerLoop.close()

## Decisions Made

- **notifyFailure replaces emitErrorActivity entirely** -- the old function only sent to Linear via agent SDK. The new function routes through the denormalizer, which already handles Slack, Linear, and GitHub. This means all channels get failure notifications, not just Linear.
- **Drain timeout uses AbortController abort** -- in-flight conversations receive abort signals and re-enqueue via the existing abort handler. The stale heartbeat detector handles recovery on the next cycle. No conversation status is set to "failed" on drain overflow (they're interrupted, not terminal).
- **pg-boss stopped before drain wait** -- prevents new timeout jobs from being scheduled while conversations are draining. The double-close with stopWorker's internal timeout scheduler close is safe (pg-boss stop is idempotent).
- **Health endpoint exposes activeClaims from WorkerLoopStatus** -- uses the existing getWorkerStatus() path rather than adding a new method to the executor.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Failure notification and graceful shutdown complete
- Ready for Plan 76-03 (recovery, if any)
- All 779 existing tests pass

## Self-Check: PASSED

- All 4 modified files verified on disk
- Both task commits (79ca48d, fa94f07) verified in git log

---
*Phase: 76-runtime-resilience*
*Completed: 2026-02-17*
