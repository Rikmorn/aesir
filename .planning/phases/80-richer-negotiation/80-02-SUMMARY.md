---
phase: 80-richer-negotiation
plan: 02
subsystem: agents
tags: [zod, signals, delegation, negotiation, clarification, tools, wait-for-state]

# Dependency graph
requires:
  - phase: 80-richer-negotiation/01
    provides: counter-propose foundation, respond_task WaitForState wiring, 5 signal types in wait_for_task
provides:
  - task:clarify tool for target agents to send clarification questions to delegators
  - task:answer tool for delegators to answer clarifications and auto-re-enter wait_for_task
  - WaitForState wiring for both tools in worker loop
  - active_delegations tracking for task_clarification signals
affects: [80-03, 80-04, agent-prompts, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [clarify-and-wait, answer-and-resume, multi-round-clarification]

key-files:
  created:
    - packages/agents/src/shared/tools/task/clarify-task.ts
    - packages/agents/src/shared/tools/task/answer-task.ts
  modified:
    - packages/agents/src/shared/tools/task/index.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/framework/worker-loop.ts

key-decisions:
  - "Clarify auto-pauses with null timeout (task timeout is the universal bound)"
  - "Answer auto-re-enters wait_for_task with all 5 delegation signal types to prevent CRITICAL-1 deadlock"
  - "Extended delegationDeps condition to include task:clarify and task:answer"

patterns-established:
  - "Clarify-and-wait: target asks question and auto-pauses in single tool call"
  - "Answer-and-resume: delegator answers and auto-re-enters wait_for_task in single tool call"
  - "Multi-round dedup: timestamp in deduplicationId allows multiple clarification rounds per task"

requirements-completed: [NEG-03, NEG-04, NEG-05]

# Metrics
duration: 4min
completed: 2026-02-20
---

# Phase 80 Plan 02: Clarification Tools Summary

**task:clarify and task:answer tools enabling mid-task question-answer flow between target and delegator agents with auto-pause/resume via WaitForState**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T18:55:48Z
- **Completed:** 2026-02-20T19:00:39Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created task:clarify tool that sends task_clarification signal and auto-pauses target conversation
- Created task:answer tool that sends task_clarification_response signal and auto-re-enters wait_for_task with all 5 delegation signal types
- Registered both tools in ToolRegistry (51 total tools) with WaitForState wiring in worker loop
- Extended delegationDeps condition to provision deps for agents with task:clarify or task:answer
- Added task_clarification tracking in computeUpdatedDelegations for active_delegations observability

## Task Commits

Each task was committed atomically:

1. **Task 1: Create task:clarify and task:answer tool factories** - `a1159cb` (feat)
2. **Task 2: Tool registration, exports, and worker-loop WaitForState wiring** - `4e48ecc` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/task/clarify-task.ts` - Target agent sends clarification to delegator, auto-pauses
- `packages/agents/src/shared/tools/task/answer-task.ts` - Delegator answers clarification, auto-re-enters wait_for_task
- `packages/agents/src/shared/tools/task/index.ts` - Barrel exports for 10 task tools
- `packages/agents/src/framework/tool-factories.ts` - Registry registration for task:clarify and task:answer (51 tools)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated assertions for 51 tool count
- `packages/agents/src/framework/worker-loop.ts` - WaitForState wiring, delegationDeps condition, computeUpdatedDelegations

## Decisions Made
- task:clarify uses null timeout (no separate timeout -- the task's own timeout is the universal bound for clarification waits)
- task:answer mirrors wait_for_task's exact 5 waitTypes to prevent the CRITICAL-1 deadlock where a completion signal arrives while the delegator is waiting for the wrong signal type
- Extended the delegationDeps condition in worker-loop.ts to also check for task:clarify and task:answer (without this, the tools would fail at runtime with "Delegation not available")
- Deduplication IDs include `Date.now()` timestamps because the same task can have multiple clarification rounds, each needing its own distinct signal

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended delegationDeps condition for new tools**
- **Found during:** Task 2 (worker-loop wiring)
- **Issue:** The worker-loop only provisions `delegationDeps` when agent tools include `task:delegate` or `task:respond`. Agents with only `task:clarify` or `task:answer` would get no deps at runtime.
- **Fix:** Extended the condition to also check `task:clarify` and `task:answer`
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** typecheck passes, all 1131 tests pass
- **Committed in:** 4e48ecc (Task 2 commit)

**2. [Rule 3 - Blocking] Updated tool-factories.test.ts assertions for 51 tools**
- **Found during:** Task 2 (test:fast after registration)
- **Issue:** Test asserted exactly 49 registered tools; now there are 51
- **Fix:** Updated both count assertions (toHaveLength and logger.info) to 51
- **Files modified:** packages/agents/src/framework/tool-factories.test.ts
- **Verification:** All 1131 tests pass
- **Committed in:** 4e48ecc (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes required for correctness. No scope creep.

## Issues Encountered
- Biome formatter required line-break in createClarifyTaskTool call in worker-loop.ts -- resolved by running `pnpm run lint:fix`

## Deferred Items
- Dashboard schema does not include `task_clarification` / `task_clarification_response` in any signal type displays. Low risk since dashboard reads signal types from events table. Should be updated in a dashboard-focused plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Clarification tools complete, ready for Plan 03 (agent prompt updates) and Plan 04 (integration test)
- Worker loop wiring for all negotiate/clarify tools is in place
- 51 tools registered total

---
*Phase: 80-richer-negotiation*
*Completed: 2026-02-20*
