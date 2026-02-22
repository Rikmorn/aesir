---
phase: 84-scheduled-execution
plan: 02
subsystem: framework
tags: [event-router, schedule, pg-boss, express, api, worker-loop]

# Dependency graph
requires:
  - "84-01: Schedule YAML schema, schedule_state table, createScheduleRegistry()"
provides:
  - "EventRouter schedule.triggered handling for synthetic schedule events"
  - "Schedule registry bootstrap wiring in main.ts with pg-boss cron registration"
  - "Worker loop schedule state updates on conversation completion/failure"
  - "POST /api/schedules/:agentId/:scheduleName/trigger manual trigger endpoint"
affects: [84-03 (dashboard schedules)]

# Tech tracking
tech-stack:
  added: []
  patterns: [schedule event handler routes through EventRouter -> executor.start() pipeline, correlationKey-from-conversationId extraction for schedule detection, overlap skip policy via 409 status code]

key-files:
  created:
    - packages/agents/src/service/api/schedule-trigger.ts
  modified:
    - packages/agents/src/framework/event-router.ts
    - packages/agents/src/framework/event-router.test.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/service/api/router.ts

key-decisions:
  - "EventRouter handles schedule.triggered as step 1.5 (between ignore check and start rules) -- not added to startRules map since it extracts agentId from event data"
  - "Schedule event handler calls eventRouter.handle() then executor.start() directly (not routeEvent()) because routeEvent expects NormalizedEvent while schedules produce IncomingEvent"
  - "Schedule detection in worker loop uses correlationKey extracted from conversation ID (no correlation_key column in conversations table)"
  - "Manual trigger uses same EventRouter -> executor.start() pipeline as scheduled runs for consistency"
  - "Skip policy returns 409 with activeConversationId for client-side feedback"
  - "API router deps (scheduleRegistry, eventRouter, executor, pool) are optional -- backward-compatible when not provided"

patterns-established:
  - "Schedule event handler: EventRouter.handle() + executor.start() (not routeEvent)"
  - "CorrelationKey extraction from conversation ID: conv.id.slice(agent_definition_id.length + 1)"
  - "Schedule state update: fire-and-forget with catch for non-fatal failure tolerance"

requirements-completed: [SCH-03, SCH-04, SCH-05, SCH-07]

# Metrics
duration: 7min
completed: 2026-02-22
---

# Phase 84 Plan 02: Schedule Service Integration Summary

**EventRouter schedule.triggered handling, main.ts bootstrap with pg-boss cron registration, worker-loop state updates on completion/failure, and manual trigger API with skip policy (409) and force flag**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-22T20:49:31Z
- **Completed:** 2026-02-22T20:57:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- EventRouter handles schedule.triggered events (step 1.5 between ignore and start rules) with 5 new unit tests
- Schedule registry bootstrapped in main.ts: created before executor, event handler wired to EventRouter -> executor.start() pipeline, registerAll() called with pg-boss
- Worker loop updates schedule state (lastRunAt, outcome, summary, runCount) on conversation completion and failure via fire-and-forget pattern
- Manual trigger API at POST /api/schedules/:agentId/:scheduleName/trigger with validation, skip policy (409), and force flag

## Task Commits

Each task was committed atomically:

1. **Task 1: EventRouter schedule.triggered handling + main.ts bootstrap + worker-loop state updates** - `cdd8397` (feat)
2. **Task 2: Manual trigger API endpoint** - `51e1987` (feat)

## Files Created/Modified
- `packages/agents/src/framework/event-router.ts` - Added schedule.triggered handling as step 1.5 in handle() method
- `packages/agents/src/framework/event-router.test.ts` - 5 new tests for schedule.triggered routing (valid, missing agentId, missing correlationKey, default message, priority)
- `packages/agents/src/framework/types.ts` - Added scheduleRegistry option to ConversationExecutorOptions
- `packages/agents/src/framework/conversation-executor.ts` - Pass scheduleRegistry through to WorkerLoopOptions
- `packages/agents/src/framework/worker-loop.ts` - Added scheduleRegistry option to WorkerLoopOptions, schedule state update on completion/failure
- `packages/agents/src/service/main.ts` - Schedule registry creation (before executor), event handler wiring, pg-boss registration, API router deps
- `packages/agents/src/service/api/schedule-trigger.ts` - Manual trigger endpoint with validation, skip policy, force flag
- `packages/agents/src/service/api/router.ts` - Mount schedule trigger router with optional deps

## Decisions Made
- **EventRouter step 1.5 placement:** schedule.triggered is handled between the ignore check and start rules check. It's not added to the startRules map because it extracts agentId from event.data rather than matching event type to a definition trigger. This keeps the start rules clean while giving schedule events deterministic routing.
- **Direct EventRouter.handle() + executor.start() (not routeEvent):** The schedule handler produces IncomingEvent, but routeEvent() in router/router.ts expects NormalizedEvent and runs adapter pipeline. Going through routeEvent would require creating a NormalizedEvent wrapper or type gymnastics. Direct handle() + start() is cleaner and equivalent for schedule events.
- **CorrelationKey from conversation ID:** The conversations table doesn't have a correlation_key column. The correlationKey is embedded in the conversation ID as {agentDefinitionId}-{correlationKey}. For schedule detection, we extract it via `conv.id.slice(conv.agent_definition_id.length + 1)` and check for the colon separator.
- **Schedule registry created before executor:** Moved schedule registry creation to step 8a (before executor at step 8) to avoid block-scoped variable used-before-declaration errors, since the executor passes scheduleRegistry to the worker loop.
- **Optional API router deps:** All schedule-related deps (scheduleRegistry, eventRouter, executor, pool) are optional on ApiRouterOptions. The schedule trigger router is only mounted when all are present. This maintains backward compatibility.
- **409 for overlap skip:** The manual trigger endpoint returns 409 with activeConversationId and activeStatus when a non-force trigger encounters an active conversation, giving the client actionable feedback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed correlation_key property access on Conversation type**
- **Found during:** Task 1 (worker-loop state updates)
- **Issue:** Plan referenced `conv.correlation_key` but the conversations table has no correlation_key column in the Drizzle schema. The correlationKey is embedded in the conversation ID.
- **Fix:** Extract correlationKey from conversation ID via `conv.id.slice(conv.agent_definition_id.length + 1)`, then check for colon separator.
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** cdd8397 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed scheduleRegistry declaration order in main.ts**
- **Found during:** Task 1 (main.ts bootstrap wiring)
- **Issue:** scheduleRegistry was used in executor options (line 207) before being declared (line 211), causing TypeScript block-scoped variable error.
- **Fix:** Moved schedule registry creation to step 8a before executor creation at step 8.
- **Files modified:** packages/agents/src/service/main.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** cdd8397 (Task 1 commit)

**3. [Rule 1 - Bug] Used EventRouter.handle() instead of routeEvent() for schedule handler**
- **Found during:** Task 1 (main.ts event handler wiring)
- **Issue:** Plan suggested using `routeEvent(event, routeEventDeps)` but routeEvent expects NormalizedEvent while the schedule handler produces IncomingEvent. Type mismatch would cause runtime errors.
- **Fix:** Event handler calls `eventRouter.handle(syntheticEvent)` directly and dispatches via `executor.start()` when action is "start". This is the correct path since schedule events don't need adapter pipeline, webhook filtering, or task routing.
- **Files modified:** packages/agents/src/service/main.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** cdd8397 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All auto-fixes necessary for correct compilation and runtime behavior. No scope creep.

## Issues Encountered
- Pre-existing test failure in `event-router.test.ts > ignore routing > ignores linear.issue.updated events` -- the test expects `linear.issue.updated` to be in IGNORE_EVENT_TYPES, but it was removed (materialization routing handles these events in the router pipeline instead). Not caused by this plan's changes.

## User Setup Required
None - no external service configuration required. The schedule trigger API is available immediately after the existing `pnpm db:migrate` and service restart.

## Next Phase Readiness
- Schedule integration is fully wired: definitions -> pg-boss cron -> EventRouter -> executor -> state updates
- Dashboard needs schedule types and UI components (Plan 03)
- Manual trigger API can be called via curl or dashboard UI once Plan 03 ships

---
*Phase: 84-scheduled-execution*
*Completed: 2026-02-22*
