---
phase: 83-tree-level-token-budgets
plan: 01
subsystem: database, agents
tags: [postgres, drizzle, schema, migration, token-budget, error-handling]

# Dependency graph
requires: []
provides:
  - "conversations.subtree_allocation, subtree_consumed, tree_budget_warning_delivered columns"
  - "taskStatusValues includes 'failed' across all 3 schema locations"
  - "tasks CHECK constraint includes counter_proposed and failed"
  - "AgentDefinitionYamlSchema.treeBudget optional field"
  - "StartConversationParams.subtreeAllocation optional field"
  - "TreeBudgetExhaustedError non-retryable error class"
  - "Conversation executor passes subtreeAllocation to DB INSERT"
affects: [83-02, 83-03, 83-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nullable subtree_allocation column for backward-compatible tree budget (BUD-06)"
    - "TreeBudgetExhaustedError uses max_tokens AgentLoopStatus for resource exhaustion"

key-files:
  created:
    - "packages/agents/src/shared/db/migrations/0022_add_tree_budget.sql"
  modified:
    - "packages/agents/src/shared/db/schema.ts"
    - "packages/agents/src/shared/db/schema.drizzle.ts"
    - "packages/dashboard/src/lib/schema.ts"
    - "packages/agents/src/framework/types.ts"
    - "packages/agents/src/shared/agent-loop/errors.ts"
    - "packages/agents/src/framework/conversation-executor.ts"

key-decisions:
  - "TreeBudgetExhaustedError uses max_tokens AgentLoopStatus (not a new status) since it represents resource exhaustion like TokenBudgetExhaustedError"
  - "Added counter_proposed to schema.drizzle.ts taskStatusValues (was missing from drizzle-kit tracking since Phase 80)"

patterns-established:
  - "Nullable allocation column pattern: NULL = no tree budget, non-null = budget active (BUD-06 backward compatibility)"

requirements-completed: [BUD-01, BUD-06]

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 83 Plan 01: Schema & Type Foundations Summary

**Tree budget columns on conversations, failed task status across all schemas, TreeBudgetExhaustedError, and executor subtreeAllocation plumbing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-23T01:18:35Z
- **Completed:** 2026-02-23T01:21:50Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added subtree_allocation, subtree_consumed, tree_budget_warning_delivered columns to conversations table via migration 0022
- Fixed long-standing tech debt: "failed" task status added to all 3 schema locations and SQL CHECK constraint updated to include both counter_proposed and failed
- Created TreeBudgetExhaustedError as non-retryable AgentLoopError for tree budget exhaustion
- Extended AgentDefinitionYamlSchema with optional treeBudget and StartConversationParams with optional subtreeAllocation
- Wired subtreeAllocation through conversation executor INSERT in both new and re-trigger paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration and Drizzle schema updates** - `a267f03c` (feat)
2. **Task 2: Type system extensions and TreeBudgetExhaustedError** - `eefe2cc4` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/migrations/0022_add_tree_budget.sql` - Migration adding tree budget columns and fixing task status CHECK constraint
- `packages/agents/src/shared/db/schema.ts` - Tree budget columns on conversations, "failed" in taskStatusValues
- `packages/agents/src/shared/db/schema.drizzle.ts` - "counter_proposed" and "failed" added to taskStatusValues
- `packages/dashboard/src/lib/schema.ts` - Tree budget columns on conversations, "failed" in taskStatusValues
- `packages/agents/src/framework/types.ts` - treeBudget in YAML schema, subtreeAllocation in StartConversationParams
- `packages/agents/src/shared/agent-loop/errors.ts` - TreeBudgetExhaustedError class
- `packages/agents/src/framework/conversation-executor.ts` - subtreeAllocation passed to both INSERT paths

## Decisions Made
- TreeBudgetExhaustedError uses `"max_tokens"` AgentLoopStatus rather than introducing a new status value, since it represents the same category (resource exhaustion, non-retryable) as TokenBudgetExhaustedError
- Added `counter_proposed` to schema.drizzle.ts taskStatusValues which was missing since Phase 80 -- drizzle-kit needs this to match database reality

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TreeBudgetExhaustedError constructor to match AgentLoopError base class**
- **Found during:** Task 2 (TreeBudgetExhaustedError creation)
- **Issue:** Plan specified `false` as second constructor arg (non-retryable boolean), but AgentLoopError takes `AgentLoopStatus` string, not a boolean
- **Fix:** Used `"max_tokens"` AgentLoopStatus which correctly represents resource exhaustion and is already handled as non-retryable by the worker loop
- **Files modified:** packages/agents/src/shared/agent-loop/errors.ts
- **Verification:** typecheck passes, error class extends AgentLoopError correctly
- **Committed in:** eefe2cc4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Constructor signature adapted to match existing base class. No scope creep -- same semantic behavior.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All schema, type, and error foundations are in place for Plans 02-04
- Migration 0022 ready to be applied via `pnpm db:migrate`
- TreeBudgetExhaustedError exported via agent-loop barrel (index.ts already exports all from errors.ts)

## Self-Check: PASSED

All 7 created/modified files verified present. Both task commits (a267f03c, eefe2cc4) verified in git log.

---
*Phase: 83-tree-level-token-budgets*
*Completed: 2026-02-23*
