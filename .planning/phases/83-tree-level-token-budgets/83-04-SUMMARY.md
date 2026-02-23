---
phase: 83-tree-level-token-budgets
plan: 04
subsystem: agents
tags: [token-budget, tree-budget, worker-loop, agent-loop, enforcement, tool]

# Dependency graph
requires:
  - phase: 83-01
    provides: "conversations.subtree_allocation, subtree_consumed, tree_budget_warning_delivered columns, TreeBudgetExhaustedError"
  - phase: 83-02
    provides: "TreeBudgetState interface and factory, propagateConsumption recursive CTE, delegation allocation wiring"
provides:
  - "Tree budget lifecycle in worker loop (init, resume, composition, propagation, warning, exhaustion)"
  - "onResponse callback returns string for [SYSTEM] message injection into agent loop"
  - "task:tree_budget tool for agent self-service budget visibility"
  - "tree_budget.warning and tree_budget.exhausted event types"
  - "Tree budget context injection at conversation start"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onResponse string return for mid-loop [SYSTEM] message injection"
    - "Effective token budget as min(definition.tokenBudget, subtreeRemaining)"
    - "Tree budget activation from definition.yaml for root conversations only"

key-files:
  created:
    - "packages/agents/src/shared/tools/task/tree-budget-tool.ts"
  modified:
    - "packages/agents/src/framework/worker-loop.ts"
    - "packages/agents/src/shared/agent-loop/run-agent-loop.ts"
    - "packages/agents/src/shared/agent-loop/types.ts"
    - "packages/agents/src/shared/db/schema.ts"
    - "packages/dashboard/src/lib/schema.ts"
    - "packages/agents/src/framework/tool-factories.ts"
    - "packages/agents/src/shared/tools/task/index.ts"
    - "packages/agents/definitions/dev-agent/definition.yaml"
    - "packages/agents/definitions/product-agent/definition.yaml"
    - "packages/agents/definitions/qa-agent/definition.yaml"

key-decisions:
  - "onResponse returns string | undefined (not void) per biome lint rule noConfusingVoidType"
  - "Effective token budget always created when tree budget present, even without spawn_agent"
  - "Tree budget context injected via context option (prepended to initial message or resumed context)"
  - "TreeBudgetExhaustedError handled in separate catch block before generic error handling for clean separation"
  - "task:tree_budget added to dev-agent, product-agent, and qa-agent (all with task:delegate)"
  - "delegationDeps condition extended to include task:tree_budget tool"

patterns-established:
  - "onResponse return-value injection: callback returns string, run-agent-loop pushes as user message before next LLM call"

requirements-completed: [BUD-01, BUD-03, BUD-04, BUD-06]

# Metrics
duration: 12min
completed: 2026-02-23
---

# Phase 83 Plan 04: Worker Loop Integration & Budget Tool Summary

**Tree budget enforcement in worker loop with 6-stage lifecycle (init, resume, compose, propagate, warn, exhaust) plus task:tree_budget self-service query tool**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-23T01:31:22Z
- **Completed:** 2026-02-23T01:43:59Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Wired complete tree budget lifecycle into worker loop: initialization from definition.yaml or inherited allocation, resume refresh, effective budget composition, consumption propagation, 80% warning injection, and 100% exhaustion check
- Extended onResponse callback signature to return string for mid-loop [SYSTEM] message injection -- backward-compatible change used by tree budget warning
- Created task:tree_budget tool returning allocation, consumed, remaining, percentUsed, and descendant breakdown (active/completed/totalConsumed)
- Registered tool in tool-factories.ts and added to all 3 delegation agents (dev-agent, product-agent, qa-agent)
- Zero overhead for conversations without tree budget: all checks gated on treeBudgetState existence

## Task Commits

Each task was committed atomically:

1. **Task 1: Worker loop tree budget lifecycle** - `4e16e4d4` (feat)
2. **Task 2: tree_budget tool and tool registration** - `89038242` (feat)

## Files Created/Modified
- `packages/agents/src/framework/worker-loop.ts` - Tree budget initialization, resume refresh, effective budget composition, consumption propagation via onResponse, warning injection, exhaustion check, TreeBudgetExhaustedError handling, context injection, delegationDeps extension
- `packages/agents/src/shared/agent-loop/run-agent-loop.ts` - Check onResponse return value, inject as [SYSTEM] user message before next LLM call
- `packages/agents/src/shared/agent-loop/types.ts` - onResponse type changed to return `string | undefined`
- `packages/agents/src/shared/db/schema.ts` - Added tree_budget.warning and tree_budget.exhausted event types
- `packages/dashboard/src/lib/schema.ts` - Added tree_budget.warning and tree_budget.exhausted event types
- `packages/agents/src/shared/tools/task/tree-budget-tool.ts` - New tool factory querying tree budget state with descendant breakdown
- `packages/agents/src/shared/tools/task/index.ts` - Barrel export for createTreeBudgetTool (14 task tools total)
- `packages/agents/src/framework/tool-factories.ts` - Registered task:tree_budget (58 total tools)
- `packages/agents/definitions/dev-agent/definition.yaml` - Added task:tree_budget
- `packages/agents/definitions/product-agent/definition.yaml` - Added task:tree_budget
- `packages/agents/definitions/qa-agent/definition.yaml` - Added task:tree_budget

## Decisions Made
- Used `string | undefined` instead of `string | void` for onResponse return type because biome's noConfusingVoidType lint rule flags void in union types. Semantically equivalent.
- Token budget is always created when treeBudgetState exists (even without spawn_agent), because tree budget enforcement needs the TokenBudget's existing exhaustion/reserve/warning checks in the agent loop.
- Tree budget context injected via the `context` option, which prepends to the initial message for new conversations or to serialized history for resumed conversations.
- TreeBudgetExhaustedError handled in its own catch block before the generic error handler for explicit non-retryable flow (fail conversation, notify, update correlation status).
- Added task:tree_budget to all agents with task:delegate (dev-agent, product-agent, qa-agent) but not test agents -- test agents don't need budget visibility.
- Extended delegationDeps condition to detect task:tree_budget so the tool has DB access via ctx.delegationDeps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed onResponse return type from `string | void` to `string | undefined`**
- **Found during:** Task 1 (onResponse type update)
- **Issue:** biome lint rule `noConfusingVoidType` rejects `void` in union types
- **Fix:** Used `string | undefined` instead -- semantically equivalent, lint-clean
- **Files modified:** packages/agents/src/shared/agent-loop/types.ts, packages/agents/src/framework/worker-loop.ts
- **Verification:** lint and typecheck pass
- **Committed in:** 4e16e4d4 (Task 1 commit)

**2. [Rule 1 - Bug] Added explicit `return undefined` to onResponse function**
- **Found during:** Task 1 (typecheck)
- **Issue:** TypeScript TS7030 "Not all code paths return a value" because the non-warning paths didn't explicitly return
- **Fix:** Added `return undefined` at the end of the onResponse callback
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** typecheck passes
- **Committed in:** 4e16e4d4 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking lint rule, 1 type error)
**Impact on plan:** Minor type adjustments required by tooling constraints. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 83 (Tree-Level Token Budgets) is now complete with all 4 plans executed
- Full end-to-end enforcement: schema (Plan 01) -> tracking (Plan 02) -> dashboard (Plan 03) -> runtime (Plan 04)
- Tree budgets are allocated from definition.yaml, enforced at runtime, visible via tool and dashboard
- Requirements BUD-01 through BUD-06 fully satisfied

## Self-Check: PASSED

All 11 created/modified files verified present. Both task commits (4e16e4d4, 89038242) verified in git log.

---
*Phase: 83-tree-level-token-budgets*
*Completed: 2026-02-23*
