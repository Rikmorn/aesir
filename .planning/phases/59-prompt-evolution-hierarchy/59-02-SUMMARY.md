---
phase: 59-prompt-evolution-hierarchy
plan: 02
subsystem: agents
tags: [task-tools, hierarchy, guardrails, circular-delegation, depth-limit, vitest]

# Dependency graph
requires:
  - phase: 58.2-task-tool-implementation
    provides: create_task tool factory, TaskService with get/listByParent methods
  - phase: 58.1-task-data-model
    provides: tasks table with parent_id, assignee_type, assignee_id columns
provides:
  - Hierarchy guardrails on create_task (depth limit, subtask cap, circular delegation prevention)
  - MAX_TASK_DEPTH and MAX_SUBTASKS_PER_PARENT constants
  - Comprehensive unit tests for all guardrail scenarios
affects: [future cross-agent delegation phases, task hierarchy features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-validation guardrails in tool layer before service.create()"
    - "Parent chain walk bounded by MAX_TASK_DEPTH for safety"
    - "Non-consecutive same-assignee detection for circular delegation"

key-files:
  created:
    - packages/agents/src/shared/tools/task/create-task.test.ts
  modified:
    - packages/agents/src/shared/tools/task/types.ts
    - packages/agents/src/shared/tools/task/create-task.ts

key-decisions:
  - "Guardrail functions as module-level helpers (not inside factory closure) for testability"
  - "Separate depth check and circular delegation walks (clarity over micro-optimization at max 5 iterations)"
  - "Broken parent chains fail safe (reject creation, do not silently allow)"

patterns-established:
  - "Pre-validation guardrail pattern: check functions return ToolResult | null"
  - "Bounded parent chain walk: always limit iterations to MAX_TASK_DEPTH"

# Metrics
duration: 5min
completed: 2026-02-08
---

# Phase 59 Plan 02: Hierarchy Guardrails Summary

**create_task enforces max depth 5, max 10 subtasks per parent, and circular delegation prevention (A->B->A blocked, A->A->A allowed) with 16 unit tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-08T00:14:18Z
- **Completed:** 2026-02-08T00:19:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added MAX_TASK_DEPTH (5) and MAX_SUBTASKS_PER_PARENT (10) constants to types.ts
- Implemented three pre-validation checks (depth, subtask cap, circular delegation) that run before taskService.create() only when parentId is provided
- Circular delegation algorithm correctly distinguishes self-decomposition (consecutive same-assignee, allowed) from hot-potato delegation (non-consecutive same-assignee, blocked)
- 16 comprehensive unit tests covering all boundary conditions and edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hierarchy constants and guardrail validation** - `410a210` (feat) -- Note: committed by parallel 59-01 agent due to shared working tree
2. **Task 2: Add comprehensive unit tests** - `b40dec5` (test) -- Note: committed by parallel 59-01 agent due to shared working tree

## Files Created/Modified
- `packages/agents/src/shared/tools/task/types.ts` - Added MAX_TASK_DEPTH (5) and MAX_SUBTASKS_PER_PARENT (10) constants
- `packages/agents/src/shared/tools/task/create-task.ts` - Added checkDepth(), checkSubtaskCap(), checkCircularDelegation() pre-validation functions
- `packages/agents/src/shared/tools/task/create-task.test.ts` - 16 unit tests covering all hierarchy guardrail scenarios

## Decisions Made
- **Guardrail functions as module-level helpers:** Placed checkDepth, checkSubtaskCap, checkCircularDelegation outside the factory function for clarity and potential reuse. They take taskService as a parameter.
- **Separate walks for depth and circular delegation:** Two separate parent chain walks (max 5 iterations each = max 10 DB calls) chosen for code clarity over a combined walk. At max depth 5, the overhead is negligible.
- **Fail safe on broken chains:** If taskService.get() returns null mid-chain, creation is rejected with an informative error rather than silently allowing the task.

## Deviations from Plan

### Issues with Parallel Execution

Task commits were absorbed by the parallel 59-01 agent's commits due to shared working tree (known issue documented in project memory). The code changes are correctly committed in `410a210` (types.ts + create-task.ts) and `b40dec5` (create-task.test.ts).

---

**Total deviations:** 0 auto-fixed. 1 process issue (parallel commit overlap, non-impactful).
**Impact on plan:** No impact on delivered code. All files are in version control with correct content.

## Issues Encountered
- Parallel 59-01 agent's `git add` picked up staged/unstaged files from this plan's work when committing. This is the documented parallel execution issue. The code is committed and correct, just under different commit messages than intended.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Hierarchy guardrails are complete and tested
- All three guardrails (depth, subtask cap, circular delegation) enforce limits before task creation
- Error messages are informative and include current state and limits
- No blockers for subsequent phases

## Self-Check: PASSED

---
*Phase: 59-prompt-evolution-hierarchy*
*Completed: 2026-02-08*
