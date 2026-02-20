---
phase: 82-transparent-materialization
plan: 05
subsystem: agents, integrations, api
tags: [materialization, linear, webhooks, reverse-sync, forward-sync, routing, wiring]

# Dependency graph
requires:
  - phase: 82-transparent-materialization
    plan: 03
    provides: LinearMaterializationAdapter, ForwardSyncListener, work correlation registration
  - phase: 82-transparent-materialization
    plan: 04
    provides: DelegationDeps.materializationAdapter, delegate_task/delegate_group materialization params
provides:
  - End-to-end materialization wiring (main.ts bootstrap, worker loop injection, router reverse sync)
  - Issue.update webhook handler in Linear integration
  - Materialized issue reverse sync routing in EventRouter
  - Forward sync composition with TaskSignalDispatcher
  - agent-work label seed script
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [materialization-reverse-sync-routing, composite-dispatcher-pattern, materialization-record-lookup]

key-files:
  created:
    - packages/integrations/linear/scripts/seed-label.ts
  modified:
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/types.ts
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/types.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/types.ts
    - packages/integrations/linear/src/api/webhooks.ts
    - packages/integrations/linear/package.json

key-decisions:
  - "Materialization routing placed after webhook filter but before task routing (step 1.4 in router pipeline)"
  - "Non-materialized linear.issue.updated events ignored in router (not in IGNORE_EVENT_TYPES) for cleaner flow"
  - "MaterializationAdapter created before executor in bootstrap to pass as constructor option (not late-bound)"
  - "Forward sync uses fire-and-forget pattern with catch for non-fatal failure tolerance"
  - "Composite dispatcher lambda wraps both signalDispatcher and forwardSyncListener"

patterns-established:
  - "Materialization reverse sync: router looks up materialization_records by external_id, calls handleWebhook, delivers signal"
  - "Composite dispatcher: single setDispatcher call wrapping multiple listeners with catch isolation"
  - "Status/assignee change detection: parse updatedFrom field to determine webhook event type"

requirements-completed: [MAT-03, MAT-06]

# Metrics
duration: 8min
completed: 2026-02-20
---

# Phase 82 Plan 05: End-to-End Materialization Wiring Summary

**Full service bootstrap wiring connecting materialization adapter, reverse sync webhook pipeline, forward sync composition, worker loop injection, and agent-work label seed script**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-20T23:09:03Z
- **Completed:** 2026-02-20T23:17:25Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Complete reverse sync pipeline: Linear Issue.update webhooks dispatched, adapter routing in router checks materialization_records, handleWebhook translates to domain signals delivered to owning conversations
- Forward sync composed with TaskSignalDispatcher via composite lambda pattern, fires async status sync on task terminal transitions
- MaterializationAdapter bootstrapped in main.ts and injected through executor -> worker loop -> DelegationDeps -> delegation tools
- Idempotent agent-work label seed script created following existing seed script patterns

## Task Commits

Each task was committed atomically:

1. **Task 1: Reverse sync pipeline** - `7a45203` (feat)
2. **Task 2: Service wiring + label seed script** - `f90d503` (feat)

## Files Created/Modified
- `packages/agents/src/adapters/linear.ts` - Added correlationKey to issue.updated events for materialization routing
- `packages/agents/src/adapters/types.ts` - Removed linear.issue.updated from IGNORE_EVENT_TYPES
- `packages/agents/src/router/router.ts` - Added materialization routing step 1.4 for linear.issue.updated events
- `packages/agents/src/router/types.ts` - Added materializationAdapter to RouteEventDeps interface
- `packages/agents/src/service/main.ts` - MaterializationAdapter creation, ForwardSyncListener composition, route deps wiring
- `packages/agents/src/framework/worker-loop.ts` - materializationAdapter in WorkerLoopOptions and DelegationDeps injection
- `packages/agents/src/framework/conversation-executor.ts` - Pass materializationAdapter through to worker loop
- `packages/agents/src/framework/types.ts` - materializationAdapter in ConversationExecutorOptions
- `packages/integrations/linear/src/api/webhooks.ts` - Issue.update webhook handler with timestamp validation and dispatch
- `packages/integrations/linear/package.json` - Added seed:labels script
- `packages/integrations/linear/scripts/seed-label.ts` - Idempotent agent-work label creation via Linear SDK

## Decisions Made
- Materialization routing placed at step 1.4 in router (after webhook filter, before task routing) so materialized issues get handled before general routing
- Non-materialized linear.issue.updated events return early as "ignored" from the router itself rather than using IGNORE_EVENT_TYPES in the EventRouter -- this keeps the logic co-located with the materialization check
- MaterializationAdapter created at bootstrap step 7d (before executor at step 8) so it can be passed as a constructor option rather than late-bound
- Forward sync uses `.catch()` isolation -- sync failures never block signal dispatch
- Router parses `updatedFrom` field to classify webhook as `status_change` or `assignee_change` for handleWebhook

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed exactOptionalPropertyTypes in emitRoutedEvent call**
- **Found during:** Task 1 (router materialization routing)
- **Issue:** `entity: incomingEvent.entityRef` produces `EntityRef | undefined` which is incompatible with optional property under exactOptionalPropertyTypes
- **Fix:** Used conditional spread pattern `...(incomingEvent.entityRef && { entity: incomingEvent.entityRef })`
- **Files modified:** packages/agents/src/router/router.ts
- **Committed in:** 7a45203

**2. [Rule 3 - Blocking] Fixed webhookTimestamp undefined guard in Issue handler**
- **Found during:** Task 1 (Linear webhook handler)
- **Issue:** `basicPayload.webhookTimestamp` typed as `number | undefined`, but `validateWebhookTimestamp` expects `number`
- **Fix:** Added explicit undefined check with early return before calling validateWebhookTimestamp
- **Files modified:** packages/integrations/linear/src/api/webhooks.ts
- **Committed in:** 7a45203

**3. [Rule 1 - Bug] Fixed Biome formatting in multiple files**
- **Found during:** Task 1 and Task 2 (pre-commit hooks)
- **Issue:** Biome formatter required single-line Set constructor, different line wrapping for chained method calls, and import sort order
- **Fix:** Applied Biome formatting requirements before successful commits
- **Files modified:** packages/agents/src/adapters/types.ts, packages/agents/src/router/router.ts, packages/integrations/linear/src/api/webhooks.ts, packages/agents/src/service/main.ts
- **Committed in:** 7a45203, f90d503

---

**Total deviations:** 3 auto-fixed (1 type error, 1 undefined guard, 1 formatting)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered
- Biome formatter required import reordering for `createId` import in webhooks.ts (placed after `@aesir/platform` but before `drizzle-orm` imports per module sort rules)
- Pre-existing unrelated file modifications in working tree (wait-for-group-tool.ts, task-signal-dispatcher.ts, graph-utils.ts) were excluded from commits via selective staging

## User Setup Required

To create the agent-work label in Linear:
```bash
pnpm --filter @aesir/integration-linear seed:labels
```
Requires `LINEAR_ACCESS_TOKEN` and `LINEAR_TEAM_ID` in `.env`.

## Next Phase Readiness
- Phase 82 (Transparent Materialization) is now complete
- End-to-end flow connected: delegation -> issue creation -> bidirectional sync -> webhook routing
- The materialization system is ready for production use with existing delegate_task and delegate_group tools
- agent-work label must be seeded before first materialization (`seed:labels`)

## Self-Check: PASSED

- Created file verified: packages/integrations/linear/scripts/seed-label.ts
- Task 1 commit (7a45203) verified in git log
- Task 2 commit (f90d503) verified in git log

---
*Phase: 82-transparent-materialization*
*Completed: 2026-02-20*
