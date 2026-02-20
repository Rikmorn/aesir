---
phase: 80-richer-negotiation
plan: 01
subsystem: agents
tags: [zod, discriminated-union, signals, delegation, negotiation, counter-propose]

# Dependency graph
requires:
  - phase: 71-delegation-handshake
    provides: task:respond accept/reject, wait_for_task, computeUpdatedDelegations
provides:
  - counter_proposed task status with VALID_TRANSITIONS
  - task_counter_proposed, task_clarification, task_clarification_response signal types
  - Discriminated union schema on task:respond (accept/reject/counter_propose)
  - Auto-acceptance of counter-proposals in wait_for_task
  - Worker-loop wiring for respond_task WaitForState and wait_for_task ToolContext
affects: [80-02, 80-03, 80-04, dashboard, agent-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminated-union-tool-input, auto-enter-wait-on-respond, auto-accept-on-wait]

key-files:
  created: []
  modified:
    - packages/agents/src/shared/tools/task/respond-task.ts
    - packages/agents/src/shared/tools/task/types.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/services/task-service.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/wait-for-task-tool.ts
    - packages/agents/src/framework/wait-for-task-tool.test.ts
    - packages/agents/src/framework/worker-loop.ts

key-decisions:
  - "Discriminated union on 'type' field replaces 'response' enum for extensibility"
  - "Counter-propose auto-enters wait_for on target side (30s timeout for task_handshake)"
  - "Auto-acceptance: wait_for_task on counter_proposed task sends acceptance signal implicitly"
  - "5 signal types in wait_for_task: completion, failure, timeout, clarification, counter_proposed"

patterns-established:
  - "Auto-enter-wait: tool can set WaitForState during its execute, creating atomic ask-and-wait"
  - "Auto-accept-on-wait: wait_for_task inspects task status and sends acceptance signal before pausing"

requirements-completed: [NEG-01, NEG-02, NEG-06]

# Metrics
duration: 6min
completed: 2026-02-20
---

# Phase 80 Plan 01: Counter-Propose Foundation Summary

**Discriminated union on task:respond with counter_proposed status, 3 new signal types, auto-acceptance in wait_for_task, and worker-loop wiring for negotiate-then-wait pattern**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T18:46:18Z
- **Completed:** 2026-02-20T18:52:40Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Replaced binary accept/reject on task:respond with discriminated union supporting counter_propose
- Added counter_proposed task status with transitions: created -> counter_proposed -> active/cancelled
- Added task_counter_proposed, task_clarification, task_clarification_response signal types
- Extended wait_for_task to listen for 5 delegation-related signals and auto-accept counter-proposals
- Wired WaitForState to respond_task in worker loop for atomic counter-propose-and-wait behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema, type, and signal foundations** - `1fee5af` (feat)
2. **Task 2: Discriminated union on task:respond + worker-loop wiring** - `d6f5c36` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/task/types.ts` - Added counter_proposed to VALID_TRANSITIONS
- `packages/agents/src/shared/db/schema.ts` - Added counter_proposed to taskStatusValues
- `packages/agents/src/shared/services/task-service.ts` - Added counter_proposed to TaskStatusSchema
- `packages/agents/src/framework/types.ts` - Added 3 new signal types to KNOWN_SIGNAL_TYPES
- `packages/agents/src/framework/wait-for-task-tool.ts` - Extended with ToolContext param, auto-acceptance, 5 waitTypes
- `packages/agents/src/framework/wait-for-task-tool.test.ts` - Updated assertion for 5 signal types
- `packages/agents/src/shared/tools/task/respond-task.ts` - Rewritten with discriminated union and counter_propose handling
- `packages/agents/src/framework/worker-loop.ts` - Added respond_task wiring, ToolContext to wait_for_task, counter_proposed in computeUpdatedDelegations

## Decisions Made
- Used `z.discriminatedUnion("type", ...)` instead of extending the existing `z.enum(["accept", "reject"])` -- this gives each response variant its own field set (estimate for accept, reason for reject, proposal+reason for counter_propose)
- Counter-propose atomically sends signal AND enters wait_for in a single tool call -- the agent does not need to call wait_for separately
- Auto-acceptance is implicit: delegator calling wait_for_task on a counter_proposed task means they accept the modified scope
- Added `counter_proposed` to `TaskStatusSchema` in task-service.ts (the plan listed only types.ts and schema.ts, but Zod validation in the service layer also needed the status)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added counter_proposed to TaskStatusSchema in task-service.ts**
- **Found during:** Task 2 (typecheck after respond-task.ts changes)
- **Issue:** `task-service.ts` has its own `TaskStatusSchema` Zod enum that validates status values. Setting `status: "counter_proposed"` would fail Zod validation at runtime.
- **Fix:** Added `"counter_proposed"` to the TaskStatusSchema enum in task-service.ts
- **Files modified:** packages/agents/src/shared/services/task-service.ts
- **Verification:** typecheck passes, all 1131 tests pass
- **Committed in:** d6f5c36 (Task 2 commit)

**2. [Rule 3 - Blocking] Updated wait-for-task-tool.test.ts for 5 signal types**
- **Found during:** Task 2 (test:fast after waitTypes extension)
- **Issue:** Existing test asserted exactly 3 waitTypes; now there are 5
- **Fix:** Updated test assertion to expect all 5 delegation-related signal types
- **Files modified:** packages/agents/src/framework/wait-for-task-tool.test.ts
- **Verification:** All 1131 tests pass
- **Committed in:** d6f5c36 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes required for correctness. No scope creep.

## Issues Encountered
- Biome lint pre-commit hook required import reordering in worker-loop.ts and formatting fixes in respond-task.ts -- resolved by running `pnpm run lint:fix`

## Deferred Items
- Dashboard schema (`packages/dashboard/src/lib/schema.ts`) has its own `taskStatusValues` that does not include `counter_proposed`. Low-risk since Drizzle enum is type-hint only and SQL queries will work. Should be updated in a dashboard-focused plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Counter-propose foundation is complete, ready for Plan 02 (prompt updates) and Plan 03 (clarification tool)
- Worker loop wiring for both wait_for_task and respond_task is in place
- Dashboard taskStatusValues update deferred (low risk)

## Self-Check: PASSED

All files found, all commits verified, SUMMARY.md created.

---
*Phase: 80-richer-negotiation*
*Completed: 2026-02-20*
