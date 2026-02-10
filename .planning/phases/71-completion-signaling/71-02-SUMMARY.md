---
phase: 71-completion-signaling
plan: 02
subsystem: agents
tags: [signal-dispatch, delegation, orphan-handling, callback-routing, task-lifecycle]

# Dependency graph
requires:
  - phase: 71-completion-signaling-01
    provides: Multi-type wait_for, signal matching, wait_for_task, completion_result column, signal.orphaned event type
  - phase: 70-task-delegation
    provides: task:delegate tool, executor.findActiveForTask(), task parent_id
provides:
  - TaskSignalDispatcher service (fires task_completion/task_failure signals on terminal task transitions)
  - Orphan handling (completion_result on task row + signal.orphaned event when callback unavailable)
  - Callback routing through parent tasks (executor.findActiveForTask)
  - TaskService.setDispatcher() late-bind hook for post-construction wiring
  - Dispatcher wiring in main.ts bootstrap
affects: [71-03, dashboard, dev-agent, product-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TaskSignalDispatcher as observer pattern: TaskService notifies on terminal transitions via callback"
    - "Late-bind setDispatcher for circular dependency avoidance (TaskService -> Dispatcher -> Executor -> TaskService)"
    - "At-most-once delivery: task row (completion_result) is durable record, signal is best-effort notification"
    - "Direct db.update for completion_result (bypasses taskService.update to avoid infinite recursion)"

key-files:
  created:
    - packages/agents/src/shared/services/task-signal-dispatcher.ts
  modified:
    - packages/agents/src/shared/services/task-service.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/shared/tools/task/complete-task.test.ts
    - packages/agents/src/shared/tools/task/create-task.test.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/router/router.test.ts

key-decisions:
  - "Late-bind setDispatcher() on TaskService (same pattern as DelegationDeps executor reference)"
  - "Capture old status with SELECT before UPDATE (not returned from UPDATE) for change detection"
  - "Direct db.update for completion_result bypasses TaskService to avoid infinite recursion"
  - "Dispatcher failures are logged but never thrown (non-fatal, at-most-once delivery)"
  - "Orphan events use synthetic conversation ID (orphan-{taskId}) since no real conversation exists"

patterns-established:
  - "TaskDispatcherCallback type: (taskId, oldStatus, newStatus, handoffContext?) => Promise<void>"
  - "completion_result shape: { signalType, payload, writtenAt, deliveryStatus, targetConversationId }"
  - "Signal deduplication: deduplicationId = '{signalType}-{taskId}' prevents duplicate delivery"

# Metrics
duration: 7min
completed: 2026-02-10
---

# Phase 71 Plan 02: Task Signal Dispatcher Summary

**TaskSignalDispatcher fires task_completion/task_failure signals to delegating agents on terminal task transitions with orphan handling via completion_result durable record**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-10T23:05:32Z
- **Completed:** 2026-02-10T23:13:09Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- TaskSignalDispatcher service fires signals to delegating agents when delegated tasks reach terminal state (completed/failed/cancelled)
- Orphan handling: writes completion_result to task row and logs signal.orphaned event when no active callback conversation exists
- Callback routing through parent tasks via executor.findActiveForTask() (not static conversation IDs)
- TaskService.setDispatcher() late-bind hook for dispatcher wiring after executor construction
- Signal payloads are self-contained with taskId, originalDescription, entityId, and type-specific fields (summary/artifacts or reason/partialResults)

## Task Commits

Each task was committed atomically:

1. **Task 1: TaskSignalDispatcher service with orphan handling** - `0b4f9f6` (feat)
2. **Task 2: TaskService dispatcher hook and main.ts wiring** - `d210a22` (feat)

## Files Created/Modified
- `packages/agents/src/shared/services/task-signal-dispatcher.ts` - Signal dispatch service with orphan handling and callback routing
- `packages/agents/src/shared/services/task-service.ts` - Added setDispatcher(), onTaskUpdate callback, old status capture
- `packages/agents/src/service/main.ts` - createTaskSignalDispatcher instantiation and wiring
- `packages/agents/src/shared/tools/task/complete-task.test.ts` - Added setDispatcher to mock
- `packages/agents/src/shared/tools/task/create-task.test.ts` - Added setDispatcher to mock
- `packages/agents/src/framework/tool-factories.test.ts` - Added setDispatcher to mock
- `packages/agents/src/router/router.test.ts` - Added setDispatcher to mock

## Decisions Made
- **Late-bind setDispatcher():** Same pattern as DelegationDeps executor reference. TaskService is created at step 4b, executor at step 8, dispatcher after executor. setDispatcher wires the callback back into TaskService.
- **SELECT before UPDATE for old status:** The update() method doesn't naturally return old status, so we query before the update. This is only done when onTaskUpdate is registered (no cost when dispatcher not wired).
- **Direct db.update for completion_result:** Using TaskService.update() would trigger onTaskUpdate again (infinite recursion). Direct Drizzle update bypasses the service layer.
- **Orphan synthetic conversation ID:** Since orphan events have no real conversation, we use `orphan-{taskId}` as a synthetic conversation ID for event logging.
- **Non-fatal dispatch failures:** Both in the dispatcher (try/catch around entire flow) and in TaskService (try/catch around callback invocation). Task updates must never fail due to signal delivery issues.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed CompletionResult type not assignable to Record<string, unknown>**
- **Found during:** Task 1
- **Issue:** Drizzle JSONB column expects `Record<string, unknown>` but TypeScript interface with explicit fields doesn't satisfy the index signature requirement
- **Fix:** Cast `completionResult as unknown as Record<string, unknown>` at the `.set()` call sites
- **Files modified:** packages/agents/src/shared/services/task-signal-dispatcher.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** 0b4f9f6 (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed setDispatcher missing from 4 test mock files**
- **Found during:** Task 2
- **Issue:** Test mocks implementing `TaskService` interface didn't include the new `setDispatcher` method
- **Fix:** Added `setDispatcher: vi.fn()` to all 4 mock functions
- **Files modified:** complete-task.test.ts, create-task.test.ts, tool-factories.test.ts, router.test.ts
- **Verification:** pnpm run typecheck passes, pnpm test:fast passes (998 tests)
- **Committed in:** d210a22 (Task 2 commit)

**3. [Rule 1 - Bug] Fixed pre-existing spread type error in worker-loop.ts**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** Uncommitted code from parallel 71-03 execution had `...(signalData?.estimate && {...})` which produces `false | {...}` -- TypeScript doesn't allow spreading non-object types
- **Fix:** Replaced conditional spread with explicit `if` block and `Record<string, unknown>` typed variable
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** 3050db4 (separate commit for pre-existing 71-03 leftover)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- Uncommitted changes from a prior parallel 71-03 execution were present in the working tree (worker-loop.ts, conversation-executor.ts). These were committed separately before proceeding with 71-02 work.

## User Setup Required
None - no external service configuration required. No new migrations needed (completion_result column added in plan 01).

## Next Phase Readiness
- TaskSignalDispatcher ready for end-to-end delegation workflow testing
- Delegation context preservation (plan 03) can now leverage the signal payloads this plan creates
- Dashboard can query `completion_result->>'deliveryStatus' = 'orphaned'` for health indicators
- All task completion paths (complete_task, transitionWithHandoff) now funnel through the dispatcher

## Self-Check: PASSED

All files exist, all commits verified, all exports confirmed.

---
*Phase: 71-completion-signaling*
*Completed: 2026-02-10*
