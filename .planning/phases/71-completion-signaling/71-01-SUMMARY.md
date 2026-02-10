---
phase: 71-completion-signaling
plan: 01
subsystem: agents
tags: [wait-for, signal-matching, delegation, pgvector, postgresql]

# Dependency graph
requires:
  - phase: 70-task-delegation
    provides: task:delegate tool, negotiation handshake, task lifecycle
provides:
  - Multi-type wait_for (string | string[] input, always stored as types array)
  - wait_for_task tool (auto-registers for task_completion/failure/timeout with taskId scoping)
  - Shared signal matching helper (signalMatchesPendingWait)
  - Schema migration 0010 (completion_result on tasks, active_delegations on conversations)
  - signal.orphaned event type
affects: [71-02, 71-03, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared signal matching helper for backward-compat type normalization"
    - "Synthetic pendingWait objects for matching waitForState against queued signals"
    - "Safety-by-design tool: wait_for_task hardcodes all 3 lifecycle signal types"

key-files:
  created:
    - packages/agents/src/framework/signal-matching.ts
    - packages/agents/src/framework/wait-for-task-tool.ts
    - packages/agents/src/shared/db/migrations/0010_completion_signaling.sql
  modified:
    - packages/agents/src/framework/wait-for-tool.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts

key-decisions:
  - "WaitForState.waitType -> waitTypes (always array) for uniform multi-type handling"
  - "Backward compat: signalMatchesPendingWait normalizes old { type } and new { types } formats"
  - "Synthetic pendingWait for worker-loop post-execution queued signal matching"
  - "wait_for_task is a separate tool (not a mode of wait_for) for safety-by-design"

patterns-established:
  - "Signal matching extracted to shared helper: both executor.signal() and worker-loop consume it"
  - "pending_wait JSONB format: { types: string[], reason, timeout, metadata } (new format)"
  - "Tool wiring pattern: worker loop wires both wait_for and wait_for_task to shared WaitForState"

# Metrics
duration: 9min
completed: 2026-02-10
---

# Phase 71 Plan 01: Completion Signaling Foundation Summary

**Multi-type wait_for with backward-compat signal matching, wait_for_task tool for task lifecycle, and schema migration for completion_result/active_delegations**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-10T22:54:05Z
- **Completed:** 2026-02-10T23:02:48Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- wait_for tool now accepts both string and string[] for the type field, normalizing to array internally
- New wait_for_task tool auto-registers for task_completion, task_failure, and task_timeout signals with taskId-scoped matching
- Signal matching extracted from inline code in conversation-executor and worker-loop to shared signalMatchesPendingWait helper
- Schema migration 0010 adds completion_result JSONB to tasks and active_delegations JSONB to conversations
- signal.orphaned added as valid agent event type for orphan handling in plans 02/03

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration and type system updates** - `106eedf` (feat)
2. **Task 2: Multi-type wait_for, signal matching helper, wait_for_task tool** - `c63a153` (feat)

## Files Created/Modified
- `packages/agents/src/framework/signal-matching.ts` - Shared signal matching helper with backward compat normalization
- `packages/agents/src/framework/wait-for-task-tool.ts` - wait_for_task tool factory (task lifecycle signals + taskId scoping)
- `packages/agents/src/shared/db/migrations/0010_completion_signaling.sql` - completion_result and active_delegations columns
- `packages/agents/src/shared/db/migrations/meta/_journal.json` - Journal entry for migration 0010
- `packages/agents/src/shared/db/schema.ts` - completion_result, active_delegations, signal.orphaned
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirror of schema.ts changes
- `packages/agents/src/framework/types.ts` - WaitForState.waitType -> waitTypes
- `packages/agents/src/framework/wait-for-tool.ts` - Multi-type support (string | string[])
- `packages/agents/src/framework/tool-factories.ts` - coordination:wait_for_task registration (tool #47)
- `packages/agents/src/framework/conversation-executor.ts` - Shared signal matching import
- `packages/agents/src/framework/worker-loop.ts` - Shared signal matching, wait_for_task wiring, types array persistence
- `packages/agents/src/framework/wait-for-tool.test.ts` - Updated for waitTypes and multi-type
- `packages/agents/src/framework/tool-factories.test.ts` - Updated tool count 44->47, added wait_for_task assertion
- `packages/agents/src/framework/worker-loop.test.ts` - Updated pending_wait assertions for types array

## Decisions Made
- **WaitForState uses waitTypes (array) not waitType (string):** Uniform internal representation avoids conditional branching everywhere. Single-type callers produce `["approval"]`, multi-type produce `["task_completion", "task_failure", "task_timeout"]`.
- **Backward compat in signal matching:** The signalMatchesPendingWait helper normalizes old `{ type: "..." }` format from existing DB rows to `[type]` array, so existing waiting conversations work without migration.
- **wait_for_task as separate tool:** Safety-by-design -- agents cannot forget to listen for failure/timeout. The tool hardcodes all 3 lifecycle signal types. This is cleaner than adding a "mode" parameter to wait_for.
- **Synthetic pendingWait for post-execution matching:** The worker loop builds a `{ types, metadata }` object from waitForState to reuse signalMatchesPendingWait for queued signal checks after the agent loop.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed completion_result missing from test mock**
- **Found during:** Task 1
- **Issue:** router.test.ts createMockTask() didn't include the new completion_result field, causing type error
- **Fix:** Added `completion_result: null` to the mock
- **Files modified:** packages/agents/src/router/router.test.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** 106eedf (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed tool count in tool-factories.test.ts**
- **Found during:** Task 2
- **Issue:** Test expected 44 tools but actual count was 47 (pre-existing drift from 46 + new wait_for_task)
- **Fix:** Updated count assertion from 44 to 47, added wait_for_task to coordination tools check
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** pnpm test:fast passes (998 tests, 0 failures)
- **Committed in:** c63a153 (Task 2 commit)

**3. [Rule 3 - Blocking] Fixed worker-loop.test.ts pending_wait assertion**
- **Found during:** Task 2
- **Issue:** Test checked `pw.type` but pending_wait now stores `types` array
- **Fix:** Changed assertion from `expect(pw.type).toBe("pr_review")` to `expect(pw.types).toEqual(["pr_review"])`
- **Files modified:** packages/agents/src/framework/worker-loop.test.ts
- **Verification:** pnpm test:fast passes
- **Committed in:** c63a153 (Task 2 commit)

**4. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes error in signal-matching.ts**
- **Found during:** Task 2
- **Issue:** Signal type has `data?: Record<string, unknown>` which with exactOptionalPropertyTypes requires explicit `| undefined`
- **Fix:** Changed parameter type to `data?: Record<string, unknown> | undefined`
- **Files modified:** packages/agents/src/framework/signal-matching.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** c63a153 (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 bug, 3 blocking)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations.

## User Setup Required
None - no external service configuration required. Migration 0010 will be applied automatically on next `pnpm db:migrate`.

## Next Phase Readiness
- completion_result column ready for plan 02 (callback routing delivers results to this column)
- active_delegations column ready for plan 03 (delegation lifecycle tracking)
- signal.orphaned event type ready for plan 02 (orphan detection and handling)
- signalMatchesPendingWait helper ready for any future signal matching needs
- wait_for_task tool ready for agents to use in delegation workflows

---
*Phase: 71-completion-signaling*
*Completed: 2026-02-10*
