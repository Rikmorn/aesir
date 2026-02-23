---
phase: 83-tree-level-token-budgets
plan: 02
subsystem: agents
tags: [token-budget, delegation, tree-budget, recursive-cte, postgres]

# Dependency graph
requires:
  - phase: 83-01
    provides: "conversations.subtree_allocation, subtree_consumed columns, StartConversationParams.subtreeAllocation"
provides:
  - "TreeBudgetState interface and factory for local cache + async DB propagation"
  - "propagateConsumption recursive CTE for atomic increment up parent chain"
  - "delegate_task passes parentConversationId and subtreeAllocation to executor.start()"
  - "delegate_group splits budget equally across group members"
  - "TREE_BUDGET_WARNING_THRESHOLD = 0.8 constant"
affects: [83-03, 83-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget DB propagation with non-fatal error handling"
    - "Recursive CTE for atomic increment up parent_conversation_id chain"
    - "Over-allocation cap to remaining with warning (not hard error)"

key-files:
  created:
    - "packages/agents/src/shared/agent-loop/tree-budget.ts"
  modified:
    - "packages/agents/src/shared/agent-loop/index.ts"
    - "packages/agents/src/shared/tools/task/delegate-task.ts"
    - "packages/agents/src/shared/tools/task/delegate-group.ts"

key-decisions:
  - "propagateConsumption uses fire-and-forget pattern (void + catch) for non-blocking ancestor updates"
  - "delegate_task default allocation is all remaining tokens (sequential delegation pattern)"
  - "delegate_group uses Math.floor for per-task allocation to avoid fractional tokens"
  - "Zero remaining is hard error; over-allocation is soft cap with warning"

patterns-established:
  - "TreeBudgetState local cache pattern: in-memory tracking with async DB propagation"
  - "Recursive CTE ancestor walk for tree-wide atomic updates"

requirements-completed: [BUD-01, BUD-02, BUD-03, BUD-06]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 83 Plan 02: Tree Budget Tracking & Delegation Allocation Summary

**TreeBudgetState module with recursive CTE propagation and budget allocation wired into delegate_task and delegate_group tools**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T01:24:43Z
- **Completed:** 2026-02-23T01:29:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created TreeBudgetState interface and factory with local cache + async DB propagation pattern
- Implemented propagateConsumption using recursive CTE for atomic increment up the parent chain
- Extended delegate_task with budgetAllocation input, parentConversationId, and subtreeAllocation pass-through
- Extended delegate_group with equal-split budget allocation across group members
- Backward compatible: conversations without tree budget (NULL subtree_allocation) skip all budget logic

## Task Commits

Each task was committed atomically:

1. **Task 1: TreeBudgetState module with consumption propagation** - `62c473ad` (feat)
2. **Task 2: Delegation tools budget allocation and parentConversationId** - `86efd695` (feat)

## Files Created/Modified
- `packages/agents/src/shared/agent-loop/tree-budget.ts` - TreeBudgetState interface, createTreeBudgetState factory, propagateConsumption recursive CTE
- `packages/agents/src/shared/agent-loop/index.ts` - Added tree-budget.ts to barrel export
- `packages/agents/src/shared/tools/task/delegate-task.ts` - budgetAllocation input, parent budget query, parentConversationId and subtreeAllocation on executor.start()
- `packages/agents/src/shared/tools/task/delegate-group.ts` - budgetAllocation input, equal-split per-task allocation, parentConversationId and subtreeAllocation on executor.start()

## Decisions Made
- propagateConsumption uses fire-and-forget pattern (void + catch) consistent with other non-blocking DB writes in the codebase (active_delegations, materialization)
- delegate_task default allocation is all remaining tokens for sequential delegation -- the child gets the full remaining budget since only one child runs at a time
- delegate_group uses Math.floor for per-task allocation to avoid fractional tokens (small remainder is acceptable)
- Zero remaining is a hard error (returns isError: true) while over-allocation is a soft cap with warning -- this matches the plan's BUD-03 requirement

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TreeBudgetState module ready for Plan 03 to wire into the agent loop (consumption recording per iteration)
- delegate_task and delegate_group both pass parentConversationId and subtreeAllocation, ready for end-to-end budget enforcement
- Plan 04 (dashboard) can query subtree_allocation and subtree_consumed for visualization

## Self-Check: PASSED

All 4 created/modified files verified present. Both task commits (62c473ad, 86efd695) verified in git log.

---
*Phase: 83-tree-level-token-budgets*
*Completed: 2026-02-23*
