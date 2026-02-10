---
phase: 67-linear-agent-sdk
plan: 05
subsystem: agents
tags: [linear-agent-sdk, activity-emission, worker-loop, mcp, lifecycle]

# Dependency graph
requires:
  - phase: 67-04
    provides: emitErrorActivity pattern in worker-loop.ts
provides:
  - emitResumeActivity helper in worker-loop.ts (thought activity on resume)
  - emitCompletionActivity helper in worker-loop.ts (response activity on completion)
  - MCP client mock infrastructure in worker-loop.test.ts
affects: [linear-agent-sdk, agent-lifecycle, session-projection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three parallel activity emission helpers (error/resume/completion) following identical pattern"
    - "Dynamic import of callMcpTool to avoid circular dependencies"
    - "Best-effort fire-and-forget activity emission with try/catch guards"

key-files:
  created: []
  modified:
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/worker-loop.test.ts

key-decisions:
  - "Resume activity uses type=thought (transitions Linear session to active state)"
  - "Completion activity uses type=response (transitions Linear session to complete state)"
  - "Resume activity fires after agent.resumed event but before task context injection for prompt state transition"
  - "Completion activity fires before DB status update so Linear reflects completion before conversation closes"

patterns-established:
  - "MCP client mock via vi.mock for dynamic import testing"
  - "MockConversationRow extended with reply_context and task_id fields"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 67 Plan 05: Session Lifecycle Activity Emissions Summary

**Resume (thought) and completion (response) activity emissions in worker-loop.ts closing Linear session lifecycle gaps**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T17:02:34Z
- **Completed:** 2026-02-10T17:06:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added emitResumeActivity helper that emits thought activity on conversation resume, transitioning Linear session to active state
- Added emitCompletionActivity helper that emits response activity on conversation completion, transitioning Linear session to complete state
- Added 7 focused unit tests covering resume/completion emission, channel guards, and failure resilience
- Established MCP client mock infrastructure (mockCallMcpTool) for worker-loop tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Add emitResumeActivity and emitCompletionActivity helpers** - `e7c50b9` (feat)
2. **Task 2: Add unit tests for activity emission** - `2c770b8` (test)

## Files Created/Modified
- `packages/agents/src/framework/worker-loop.ts` - Added emitResumeActivity and emitCompletionActivity helpers, called from resume path and completion path respectively
- `packages/agents/src/framework/worker-loop.test.ts` - Added 7 tests for activity emission, MCP client mock, extended MockConversationRow

## Decisions Made
- Resume activity uses type=thought (matches Linear SDK's session state machine: thought -> active)
- Completion activity uses type=response (matches Linear SDK's session state machine: response -> complete)
- Resume fires after agent.resumed event but before task context injection (early state transition)
- Completion fires before DB update (Linear reflects completion before conversation closes)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 67 (Linear Agent SDK) gap closure is now complete with all 5 plans shipped
- All three infrastructure activity helpers (error, resume, completion) follow identical patterns
- Linear session lifecycle is fully covered: start (via adapter), resume (thought), active (agent tools), complete (response), error (error)
- Ready to continue with Phase 68 (Shared Memory)

## Self-Check: PASSED

- FOUND: packages/agents/src/framework/worker-loop.ts
- FOUND: packages/agents/src/framework/worker-loop.test.ts
- FOUND: .planning/phases/67-linear-agent-sdk/67-05-SUMMARY.md
- FOUND: commit e7c50b9 (Task 1)
- FOUND: commit 2c770b8 (Task 2)

---
*Phase: 67-linear-agent-sdk*
*Completed: 2026-02-10*
