---
phase: 78-work-correlation
plan: 06
subsystem: agents
tags: [event-routing, correlation, disposition, slow-path, entity-update, work-correlation]

# Dependency graph
requires:
  - phase: 78-02
    provides: "entityRef extraction on all adapter events"
  - phase: 78-03
    provides: "CorrelationService with queryActive, queryTerminal methods"
  - phase: 78-05
    provides: "correlationService wired into RouteEventDeps, entityRef on StartConversationParams"
provides:
  - Disposition and RoutingMethod type vocabulary for routing decisions
  - CorrelationContext type for slow-path enrichment
  - emitRoutedEvent helper for event.routed direct DB inserts
  - event.routed emissions at trigger_match, signal_match, and correlation_fallback decision points
  - Correlation fallback routing (active correlations signaled, terminal correlations enrich slow-path)
  - entityRef pass-through from router to executor.start() for auto-registration
  - Enriched formatEventForLLM with terminal work history context
  - Router system prompt guidance for retry/supersede disposition decisions
affects: [dashboard, observability, event-routing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Narrowing-first pattern for exactOptionalPropertyTypes: use firstActive = arr[0]; if (firstActive) instead of arr[0]!."
    - "Direct DB insert for event.routed (bypasses EventLog which requires initSequence per conversation_id)"
    - "Conditional spread for entityRef pass-through to satisfy exactOptionalPropertyTypes"

key-files:
  created: []
  modified:
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/slow-path.ts
    - packages/agents/src/router/system-prompt.ts

key-decisions:
  - "Conditional spread for entityRef and entity params to satisfy exactOptionalPropertyTypes (no non-null assertions)"
  - "Narrowing via firstActive = arr[0]; if (firstActive) pattern instead of arr[0]! for Biome noNonNullAssertion rule"
  - "emitRoutedEvent uses direct DB insert (not EventLog) because EventLog requires initSequence per conversation_id"
  - "Correlation fallback broadcasts entity_update signal to all active/waiting conversations"

patterns-established:
  - "Correlation fallback routing order: active correlations -> signal; terminal -> enrich slow-path; none -> existing behavior"
  - "event.routed emissions at non-duplicate/non-ignore routing decisions for dashboard visibility"

requirements-completed: [CORR-06, CORR-07]

# Metrics
duration: 4min
completed: 2026-02-17
---

# Phase 78 Plan 06: Correlation Router Integration Summary

**Work-aware routing pipeline with correlation fallback, disposition vocabulary, event.routed emissions, and slow-path enrichment for retry/supersede decisions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-17T23:30:21Z
- **Completed:** 2026-02-17T23:35:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added Disposition (new/signal/retry/supersede/duplicate) and RoutingMethod (trigger_match/signal_match/correlation_fallback/slow_path) type vocabulary to router types
- Implemented correlation fallback in the slow_path case: active correlations are broadcast-signaled with entity_update, terminal correlations enrich slow-path LLM context
- emitRoutedEvent helper inserts event.routed events via direct DB insert at trigger_match, signal_match, and correlation_fallback decision points
- entityRef is passed through from IncomingEvent to executor.start() for auto-registration (wired in Plan 05)
- formatEventForLLM appends terminal work history when CorrelationContext is provided
- Router system prompt includes existing_work_context guidance for retry/supersede reasoning

## Task Commits

Each task was committed atomically:

1. **Task 1: Add disposition types, event.routed emission, and entityRef pass-through** - `a7031c2` (feat)
2. **Task 2: Implement correlation fallback routing and slow-path enrichment** - `62eb26f` (feat)

## Files Created/Modified
- `packages/agents/src/router/types.ts` - Added Disposition, RoutingMethod, CorrelationContext types; correlationContext field on EventRouterDeps and RouteEventDeps
- `packages/agents/src/router/router.ts` - emitRoutedEvent helper, event.routed at trigger_match/signal_match/correlation_fallback, correlation fallback in slow_path case, entityRef conditional spread to start()
- `packages/agents/src/router/slow-path.ts` - formatEventForLLM accepts CorrelationContext, appends terminal work history; routeViaAgentLoopV2 threads correlationContext from deps
- `packages/agents/src/router/system-prompt.ts` - Added existing_work_context section for retry/supersede disposition guidance

## Decisions Made
- **Conditional spread for entityRef:** Used `...(routeDecision.event.entityRef && { entityRef: routeDecision.event.entityRef })` instead of direct assignment because `exactOptionalPropertyTypes` rejects `undefined` values on optional properties.
- **Narrowing pattern for array access:** Used `const firstActive = activeCorrelations[0]; if (firstActive)` instead of `activeCorrelations[0]!` because Biome's `noNonNullAssertion` rule forbids the `!` operator.
- **Direct DB insert for event.routed:** EventLog requires `initSequence()` per conversation_id which doesn't apply for synthetic router-scoped events. Direct insert with `createId.agentEvent()` avoids this constraint.
- **Broadcast to all active correlations:** Per CONTEXT.md, entity_update signals are broadcast to all active/waiting conversations for the entity, not just the first one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes violations for entityRef and entity params**
- **Found during:** Task 1 (entityRef pass-through and emitRoutedEvent calls)
- **Issue:** Passing `entityRef: routeDecision.event.entityRef` directly when entityRef could be `undefined` violates `exactOptionalPropertyTypes`. Same issue with `entity` param in emitRoutedEvent calls.
- **Fix:** Used conditional spread pattern: `...(value && { key: value })` for all optional fields
- **Files modified:** packages/agents/src/router/router.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** a7031c2 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed noNonNullAssertion lint error for array access**
- **Found during:** Task 2 (correlation fallback implementation)
- **Issue:** `activeCorrelations[0]!.conversationId` uses non-null assertion which Biome forbids. Using `[0]?.conversationId` produces `string | undefined` which violates exactOptionalPropertyTypes.
- **Fix:** Extracted `const firstActive = activeCorrelations[0]; if (firstActive)` for proper narrowing
- **Files modified:** packages/agents/src/router/router.ts
- **Verification:** Biome lint passes, `pnpm run typecheck` passes
- **Committed in:** 62eb26f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes necessary for TypeScript strictness and Biome lint compliance. No scope creep.

## Issues Encountered
None -- plan executed as specified with only TypeScript strictness adjustments.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 78 (Work Correlation) is now complete with all 6 plans executed
- Full pipeline: adapters extract entityRef -> executor auto-registers correlations -> worker loop propagates status -> correlation fallback routes entity events -> event.routed provides observability
- All correlation infrastructure available for agents via work:register and work:query tools

## Self-Check: PASSED

- All 4 modified files verified on disk
- Both commit hashes (a7031c2, 62eb26f) found in git log

---
*Phase: 78-work-correlation*
*Completed: 2026-02-17*
