---
phase: 80-richer-negotiation
plan: 05
subsystem: agents
tags: [delegation, negotiation, counter-proposal, signals, task-lifecycle]

# Dependency graph
requires:
  - phase: 80-richer-negotiation (plans 01-02)
    provides: respond-task tool with counter-propose, wait_for_task auto-accept
provides:
  - originalDescription in rejection signal payload for history-compacted context
  - Explicit counter-proposal rejection via wait_for_task action='reject'
affects: [agent-collaboration, delegation-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional signal payload enrichment via spread operator"
    - "Immediate return from wait_for_task without setting waitForState for non-pausing actions"

key-files:
  created: []
  modified:
    - packages/agents/src/shared/tools/task/respond-task.ts
    - packages/agents/src/framework/wait-for-task-tool.ts

key-decisions:
  - "Reject signal payload includes originalDescription only for reject type (not accept) since accept continues the conversation"
  - "Counter-proposal rejection returns immediately without pausing -- delegator continues to re-delegate or pivot"

patterns-established:
  - "Action parameter with default for backward-compatible tool extension"

requirements-completed: [NEG-01]

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 80 Plan 05: Gap Closure Summary

**Rejection signal payload enriched with originalDescription, explicit counter-proposal rejection via wait_for_task action='reject' without 30s timeout dependency**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T19:41:44Z
- **Completed:** 2026-02-20T19:43:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Rejection signals now carry `originalDescription` (task.objective ?? task.title), matching the counter-propose signal pattern for history-compacted conversations
- Delegators can explicitly reject counter-proposals via `wait_for_task({ taskId, action: "reject" })` with immediate task cancellation
- Full backward compatibility preserved -- existing callers without `action` parameter continue to auto-accept

## Task Commits

Each task was committed atomically:

1. **Task 1: Add originalDescription to rejection signal in respond-task.ts** - `45d35d9` (feat)
2. **Task 2: Add reject action to wait_for_task for counter-proposal rejection** - `f7986d1` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/task/respond-task.ts` - Added originalDescription to reject branch signal data
- `packages/agents/src/framework/wait-for-task-tool.ts` - Added action param (accept/reject), reject branch with task_handshake signal and task cancellation

## Decisions Made
- Reject signal carries originalDescription only for the reject type (not accept), since accept transitions to active and the delegator continues with full context already
- Counter-proposal rejection returns immediately from wait_for_task without setting waitForState -- the delegator should not pause after rejecting, they need to decide next steps

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both NEG-01 gaps from 80-VERIFICATION.md are closed
- Phase 80 gap closure complete, ready for Phase 81 transition

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 80-richer-negotiation*
*Completed: 2026-02-20*
