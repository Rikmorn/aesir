---
phase: 81-parallel-delegation
plan: 02
subsystem: agents
tags: [parallel-delegation, task-tools, zod, group-tools, cancellation]

# Dependency graph
requires:
  - phase: 81-01
    provides: "GroupService CRUD, task_groups schema, evaluatePolicy"
provides:
  - "delegate_group tool factory (createDelegateGroupTool)"
  - "group_status tool factory (createGroupStatusTool)"
  - "cancel_group tool factory (createCancelGroupTool)"
  - "DelegationDeps extended with optional groupService and timeoutScheduler"
affects: [81-03, 81-04, 81-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic group validation: all tasks validated before any creation"
    - "Rollback on partial failure: cancel started conversations and mark group cancelled"
    - "Terminal state guards: cancel_group no-ops on already-terminal groups"

key-files:
  created:
    - packages/agents/src/shared/tools/task/delegate-group.ts
    - packages/agents/src/shared/tools/task/group-status.ts
    - packages/agents/src/shared/tools/task/cancel-group.ts
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/shared/tools/task/index.ts

key-decisions:
  - "Direct DB update for group_id on tasks (TaskService.create does not accept groupId)"
  - "Capability routing returns explicit error referencing Phase 85 (forward-compatible schema)"
  - "Group timeout scheduling is no-op when timeoutScheduler is undefined (Plan 04 wires it)"

patterns-established:
  - "Group tool pattern: check delegationDeps.groupService before proceeding"
  - "Batch active_delegations tracking with groupId metadata"

requirements-completed: [PAR-01, PAR-04, PAR-06]

# Metrics
duration: 10min
completed: 2026-02-20
---

# Phase 81 Plan 02: Group Tools Summary

**Three LLM-facing group tools (delegate_group, group_status, cancel_group) with Zod validation, atomic rollback, and policy-driven completion semantics**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-20T20:53:22Z
- **Completed:** 2026-02-20T21:03:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- delegate_group tool validates all tasks atomically (agentId/capability XOR, min 2 tasks), creates group + tasks with rollback on partial failure, schedules optional timeout
- group_status tool returns aggregated group state with policy assessment (satisfied/unsatisfiable/in progress) and per-task breakdown
- cancel_group tool sends task_cancelled signal to running tasks, handles terminal groups gracefully, cancels timeout job
- DelegationDeps extended with optional groupService and timeoutScheduler for Phase 81

## Task Commits

Each task was committed atomically:

1. **Task 1: delegate_group and group_status tools** - `e56bf52` (feat)
2. **Task 2: cancel_group tool and barrel re-export** - `cac3fe2` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/task/delegate-group.ts` - delegate_group tool factory with atomic validation, rollback, timeout scheduling
- `packages/agents/src/shared/tools/task/group-status.ts` - group_status tool factory with policy assessment and per-task detail
- `packages/agents/src/shared/tools/task/cancel-group.ts` - cancel_group tool factory with cascading signal dispatch
- `packages/agents/src/framework/types.ts` - DelegationDeps extended with groupService and timeoutScheduler
- `packages/agents/src/shared/tools/task/index.ts` - Barrel re-export updated (10 -> 13 task tools)

## Decisions Made
- Used direct DB update to set group_id on tasks after creation, since TaskService.create does not accept a groupId parameter. The group_id column exists on the tasks table but the service layer does not expose it in CreateTaskParams.
- Capability-based routing returns an explicit error message referencing Phase 85, keeping the schema forward-compatible (agentId/capability discriminated union in Zod).
- Group timeout scheduling uses optional chaining on deps.timeoutScheduler -- this is a no-op until Plan 04 wires the scheduler into DelegationDeps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale types build caused false typecheck failure**
- **Found during:** Task 1
- **Issue:** types package build output did not include taskGroup ID generator, causing TS2339 error in group-service.ts
- **Fix:** Rebuilt @aesir/types package (`pnpm --filter @aesir/types run build`)
- **Files modified:** None (build output only)
- **Verification:** Typecheck passes after rebuild

**2. [Rule 1 - Bug] Non-null assertions rejected by linter**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** Biome noNonNullAssertion rule rejects `array[i]!` pattern
- **Fix:** Changed to `for...of` with `.entries()` and defensive guard for entity lookup
- **Files modified:** packages/agents/src/shared/tools/task/delegate-group.ts
- **Verification:** Linter passes, typecheck passes

**3. [Rule 1 - Bug] Export sort order in barrel file**
- **Found during:** Task 2 (pre-commit hook)
- **Issue:** Biome organizeImports rule requires exports sorted by module path
- **Fix:** Moved delegate-group.js export before delegate-task.js
- **Files modified:** packages/agents/src/shared/tools/task/index.ts
- **Verification:** Linter passes

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All auto-fixes necessary for lint/build compliance. No scope creep.

## Issues Encountered
- Plan 01 (GroupService) executed in parallel -- group-service.ts appeared during execution. The import from types.ts resolved correctly once Plan 01 committed its files.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Three group tools ready for registration in tool-factories.ts (Plan 03)
- Tools depend on GroupService being injected into DelegationDeps.groupService (Plan 04 wires this)
- cancel_group depends on pending_cancellation pattern in worker loop (Plan 05)

## Self-Check: PASSED

All 3 created files verified on disk. Both task commits (e56bf52, cac3fe2) found in git log.

---
*Phase: 81-parallel-delegation*
*Completed: 2026-02-20*
