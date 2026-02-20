---
phase: 81-parallel-delegation
plan: 04
subsystem: agents
tags: [parallel-delegation, tool-registry, worker-loop, wait-for-group, group-tools]

# Dependency graph
requires:
  - phase: 81-01
    provides: "GroupService factory, task_groups schema"
  - phase: 81-02
    provides: "delegate_group, group_status, cancel_group tool factories"
provides:
  - "wait_for_group tool factory (createWaitForGroupTool) with policy/settled modes"
  - "All 4 group tools registered in ToolRegistry (55 total)"
  - "GroupService wired into DelegationDeps in worker loop"
  - "TimeoutScheduler wired into DelegationDeps for group timeout scheduling"
  - "GroupService created and passed to TaskSignalDispatcher in main.ts"
affects: [81-05, 81-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "wait_for_group follows same mutable WaitForState interception pattern as wait_for and wait_for_task"
    - "Group timeout delegated to pg-boss (wait_for_group.timeout is always null)"

key-files:
  created:
    - packages/agents/src/framework/wait-for-group-tool.ts
  modified:
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/service/main.ts

key-decisions:
  - "GroupService created in worker loop (conditional on taskService existence) and in main.ts (unconditional for dispatcher)"
  - "Group timeout uses null in waitForState.timeout since pg-boss handles scheduling via delegate_group"
  - "DelegationDeps condition extended to detect group tool refs alongside existing delegation tool refs"

patterns-established:
  - "Group tool wiring pattern: same WaitForState interception as wait_for_task, extended to wait_for_group"

requirements-completed: [PAR-05]

# Metrics
duration: 4min
completed: 2026-02-20
---

# Phase 81 Plan 04: Tool Integration and Worker Loop Wiring Summary

**wait_for_group tool with policy/settled wake modes, 4 group tools registered in ToolRegistry (55 total), and GroupService wired through worker loop DelegationDeps and main.ts dispatcher**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T21:06:59Z
- **Completed:** 2026-02-20T21:11:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- wait_for_group tool with two modes: "policy" (wakes on satisfaction/unsatisfiability/task failure) and "settled" (wakes when all tasks terminal)
- All 4 group tools registered in ToolRegistry: task:delegate_group, task:group_status, task:cancel_group, coordination:wait_for_group
- Worker loop creates GroupService and injects it alongside timeoutScheduler into DelegationDeps
- GroupService created in main.ts and passed to TaskSignalDispatcher for group-aware signal dispatch

## Task Commits

Each task was committed atomically:

1. **Task 1: wait_for_group tool** - `ab0616e` (feat)
2. **Task 2: Tool registration and worker loop wiring** - `534bc94` (feat)

## Files Created/Modified
- `packages/agents/src/framework/wait-for-group-tool.ts` - wait_for_group tool factory with policy/settled wake modes, groupId metadata, group timeout signal type
- `packages/agents/src/framework/tool-factories.ts` - 4 new tool registrations (51 -> 55 total), imports for group tools and wait_for_group
- `packages/agents/src/framework/worker-loop.ts` - GroupService creation, DelegationDeps extension with groupService + timeoutScheduler, wait_for_group interception wiring
- `packages/agents/src/service/main.ts` - GroupService creation and injection into TaskSignalDispatcher options

## Decisions Made
- **GroupService in worker loop is conditional:** Only created when `taskService` exists (same guard as other delegation deps). In main.ts, it's always created since the dispatcher is always instantiated.
- **Group timeout is null in WaitForState:** Unlike wait_for_task which can pass a timeout to the scheduler, wait_for_group delegates timeout scheduling to delegate_group (which already calls timeoutScheduler.schedule). Setting waitForState.timeout = null prevents double-scheduling.
- **DelegationDeps condition extended:** Added checks for `task:delegate_group`, `task:group_status`, and `task:cancel_group` so agents using group tools get DelegationDeps populated without needing `task:delegate` in their tool list.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 group tools are registered, wired, and functional within the worker loop
- Agents with these tools in their definition can now call delegate_group, wait_for_group, group_status, and cancel_group
- Group timeouts are scheduled via pg-boss through the existing TimeoutScheduler infrastructure
- Ready for Plan 05 (prompt updates) and Plan 06 (agent integration tests)

## Self-Check: PASSED

All 4 files verified on disk. Both task commits (ab0616e, 534bc94) found in git log.

---
*Phase: 81-parallel-delegation*
*Completed: 2026-02-20*
