---
phase: 76-runtime-resilience
plan: 03
subsystem: agents
tags: [recovery-context, event-log, crash-recovery, resilience, worker-loop]

# Dependency graph
requires:
  - phase: 76-01
    provides: "last_persisted_sequence column in conversations table, retry_count/max_retries columns"
  - phase: 76-02
    provides: "notifyFailure, graceful shutdown, abort re-enqueue pattern"
provides:
  - "buildRecoveryContext() function for crash recovery visibility"
  - "EventLog.getSequence() method for in-memory sequence retrieval"
  - "last_persisted_sequence tracking at all 6 message persistence boundaries"
  - "Recovery context injection at conversation resume path"
affects: [agent-prompts, history-manager, observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XML-tagged recovery context block (<recovery_context>) injected as user message on resume"
    - "Event log query with afterSequence filter for crash recovery window"
    - "getSequence() in-memory counter avoids DB round-trip for sequence tracking"

key-files:
  created: []
  modified:
    - "packages/agents/src/framework/worker-loop.ts"
    - "packages/agents/src/framework/types.ts"
    - "packages/agents/src/framework/event-log.ts"
    - "packages/agents/definitions/dev-agent/prompt.md"
    - "packages/agents/definitions/product-agent/prompt.md"

key-decisions:
  - "Added getSequence() to EventLog interface rather than tracking sequence in a local variable -- cleaner separation of concerns"
  - "Recovery context injection wrapped in try/catch as non-fatal -- agent resumes without context rather than failing"
  - "6 persistence boundaries identified (including queued signal at pause point) -- plan specified 5"

patterns-established:
  - "Recovery context as XML-tagged user message: <recovery_context>...</recovery_context>"
  - "Event types for recovery window: tool.succeeded, tool.failed, agent.completed, signal.received"

requirements-completed: [RESIL-08, RESIL-09]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 76 Plan 03: Recovery Context Summary

**Recovery context injection for crash-resumed conversations using event log replay after last_persisted_sequence checkpoint**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T00:14:58Z
- **Completed:** 2026-02-17T00:20:14Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- EventLog.getSequence() method added to interface and implementation for in-memory sequence retrieval
- last_persisted_sequence tracked at all 6 message persistence boundaries in worker-loop.ts
- buildRecoveryContext() queries event log for post-checkpoint events and formats as XML block
- Recovery context injected as user message at resume path, after task context and active delegations
- Orchestrator agent prompts (dev-agent, product-agent) updated with recovery_context awareness

## Task Commits

Each task was committed atomically:

1. **Task 1: Track last_persisted_sequence at all message persistence boundaries** - `b3acfca` (feat)
2. **Task 2: Build and inject recovery context on conversation resume** - `b293612` (feat)

## Files Created/Modified
- `packages/agents/src/framework/types.ts` - Added getSequence() to EventLog interface
- `packages/agents/src/framework/event-log.ts` - Implemented getSequence() returning in-memory sequence counter
- `packages/agents/src/framework/worker-loop.ts` - Added last_persisted_sequence at 6 boundaries, buildRecoveryContext(), truncateOutput(), recovery context injection
- `packages/agents/src/framework/worker-loop.test.ts` - Updated mock EventLog with getSequence
- `packages/agents/src/framework/conversation-executor.test.ts` - Updated mock EventLog with getSequence
- `packages/agents/src/framework/session-projection.test.ts` - Updated mock EventLog with getSequence
- `packages/agents/src/shared/tools/coordination/spawn-agent.test.ts` - Updated mock EventLog with getSequence
- `packages/agents/definitions/dev-agent/prompt.md` - Added recovery_context constraint
- `packages/agents/definitions/product-agent/prompt.md` - Added recovery_context constraint

## Decisions Made
- Added getSequence() to EventLog interface rather than tracking sequence in a local variable -- the EventLog already maintains per-conversation sequence counters internally, so exposing them avoids duplication and keeps the source of truth centralized
- Identified 6 persistence boundaries (plan specified 5) -- the queued-signal-consumed-at-pause-point path also persists messages and was included
- Recovery context injection wrapped in try/catch as non-fatal -- a failure to build recovery context should not prevent the conversation from resuming

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated all mock EventLog definitions in test files**
- **Found during:** Task 1
- **Issue:** worker-loop.test.ts mock uses `satisfies EventLog` which would fail type-checking without getSequence
- **Fix:** Added `getSequence: vi.fn().mockReturnValue(0)` to all 4 test file mocks
- **Files modified:** worker-loop.test.ts, conversation-executor.test.ts, session-projection.test.ts, spawn-agent.test.ts
- **Verification:** All 779 tests pass
- **Committed in:** b3acfca (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for type safety when extending the EventLog interface. No scope creep.

## Issues Encountered
- Pre-commit lint hook caught formatting issues in Task 2 (template literal preference, line wrapping) -- fixed inline before re-committing

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 76 (Runtime Resilience) complete -- all 3 plans executed
- Recovery context, MCP retry, failure notification, graceful shutdown, and last_persisted_sequence tracking all operational
- Ready for Phase 77 (Observability) or Phase 78 (Event Pipeline) depending on milestone plan

---
*Phase: 76-runtime-resilience*
*Completed: 2026-02-17*
