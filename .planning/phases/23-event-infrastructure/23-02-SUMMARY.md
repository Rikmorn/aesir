---
phase: 23-event-infrastructure
plan: 02
subsystem: events
tags: [dispatcher, event-normalization, linear, http-dispatch, fire-and-forget]

# Dependency graph
requires:
  - phase: 23-01
    provides: NormalizedEventSchema, createId.event(), nginx webhook hardening
provides:
  - Linear event dispatcher module for routing webhooks to agents
  - normalizeAgentSessionEvent function for Linear webhook conversion
  - DISPATCH_ROUTES configuration for dev-agent targeting
affects: [23-03, 23-04, agents]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration-embedded dispatcher pattern (each integration dispatches its own events)"
    - "Fire-and-forget HTTP dispatch (non-blocking webhook response)"
    - "Event normalization at webhook handler level"

key-files:
  created:
    - packages/integrations/linear/src/dispatcher/routes.ts
    - packages/integrations/linear/src/dispatcher/client.ts
    - packages/integrations/linear/src/dispatcher/normalize.ts
    - packages/integrations/linear/src/dispatcher/index.ts
  modified:
    - packages/integrations/linear/src/api/webhooks.ts

key-decisions:
  - "Dispatcher created per-request within webhook router (not global singleton)"
  - "Fire-and-forget pattern: dispatch does not await response, errors logged only"
  - "Normalization happens after callback but before response (atomic within request)"
  - "Route targets use Docker service names with env override capability"

patterns-established:
  - "Dispatcher module structure: routes.ts, client.ts, normalize.ts, index.ts"
  - "createDispatcher factory with logger and routes injection"
  - "normalizeXxxEvent function converts integration payload to NormalizedEvent"

# Metrics
duration: 5min
completed: 2026-01-25
---

# Phase 23 Plan 02: Linear Event Normalizer Summary

**Linear dispatcher module with AgentSession normalization and fire-and-forget HTTP dispatch to dev-agent /events endpoint**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-25T22:15:00Z
- **Completed:** 2026-01-25T22:20:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created dispatcher module with routing configuration for Linear events
- Implemented normalizeAgentSessionEvent to convert Linear webhooks to NormalizedEvent format
- Integrated dispatcher into Linear webhook handler for fire-and-forget dispatch
- Configured DISPATCH_ROUTES targeting dev-agent:3004/events

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Linear dispatcher module** - `9c8dba4` (feat)
2. **Task 2: Integrate dispatcher into Linear webhook handler** - `1d57ee4` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/dispatcher/routes.ts` - DispatchRoute interface and DISPATCH_ROUTES config
- `packages/integrations/linear/src/dispatcher/client.ts` - createDispatcher factory with fire-and-forget HTTP dispatch
- `packages/integrations/linear/src/dispatcher/normalize.ts` - normalizeAgentSessionEvent function
- `packages/integrations/linear/src/dispatcher/index.ts` - Barrel export for dispatcher module
- `packages/integrations/linear/src/api/webhooks.ts` - Added dispatcher creation and event dispatch after processing

## Decisions Made
- **Dispatcher per-request:** Created inside createWebhookRouter to share logger context rather than global singleton
- **Fire-and-forget dispatch:** `dispatch()` returns void and does not block; errors are logged but not propagated
- **Payload normalization:** Extracts sessionId, issueId, status, url, and creatorId from AgentSession webhook - matches actual Linear webhook shape (not the plan's assumption about agentId/prompt fields)
- **Route targeting:** Uses Docker service name `dev-agent:3004` with DEV_AGENT_URL env override for flexibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected normalized event payload structure**
- **Found during:** Task 1 (normalizeAgentSessionEvent implementation)
- **Issue:** Plan specified `agentId` and `prompt` fields, but AgentSessionPayload interface doesn't have these fields
- **Fix:** Used actual fields from AgentSessionPayload: sessionId, issueId, status, url, creatorId
- **Files modified:** packages/integrations/linear/src/dispatcher/normalize.ts
- **Verification:** Typecheck passes with actual interface types
- **Committed in:** 9c8dba4 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix aligned implementation with actual type definitions. No scope creep.

## Issues Encountered
- **Formatting pre-commit hook:** Initial commit failed due to Biome formatting requirement for multi-line function arguments. Fixed by reformatting logger.debug call.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Linear dispatcher module complete and integrated
- Events dispatched to http://dev-agent:3004/events (Docker service name)
- Ready for Plan 03: GitHub event normalizer (same pattern)
- Dev-agent /events endpoint needed (Plan 05) to receive dispatched events

---
*Phase: 23-event-infrastructure*
*Completed: 2026-01-25*
