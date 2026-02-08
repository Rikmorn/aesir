---
phase: 62-router-updates
plan: 01
subsystem: router
tags: [replyContext, slow-path, event-routing, zod, auto-injection]

# Dependency graph
requires:
  - phase: 61-reply-context-foundation
    provides: "ReplyContext type, ReplyContextSchema, replyContext on IncomingEvent and Signal"
provides:
  - "eventReplyContext field on EventRouterDeps interface"
  - "replyContext field on signal_conversation and start_conversation tool schemas"
  - "Auto-injection of replyContext from incoming event into slow-path tool calls"
  - "Slow-path dispatch threads eventReplyContext from routeDecision.event"
affects: [62-02, 62-03, router-tools, slow-path-routing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "eventReplyContext auto-injection: input.replyContext ?? deps.eventReplyContext"
    - "Conditional spread for exactOptionalPropertyTypes: ...(replyContext && { replyContext })"

key-files:
  created: []
  modified:
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/tools/signal-conversation.ts
    - packages/agents/src/router/tools/start-conversation.ts
    - packages/agents/src/router/router.ts

key-decisions:
  - "Auto-injection pattern: LLM-provided replyContext takes precedence over deps.eventReplyContext"
  - "Conditional spread used consistently for exactOptionalPropertyTypes compliance"

patterns-established:
  - "eventReplyContext auto-injection: tools receive replyContext from deps when LLM omits it"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 62 Plan 01: Router replyContext Forwarding Summary

**Slow-path replyContext auto-injection via EventRouterDeps, signal_conversation, and start_conversation tool schemas**

## Performance

- **Duration:** 2 min 25 sec
- **Started:** 2026-02-08T23:30:44Z
- **Completed:** 2026-02-08T23:33:09Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended EventRouterDeps with eventReplyContext field for auto-injection into slow-path tools
- Added ReplyContextSchema-validated replyContext field to both signal_conversation and start_conversation tool schemas
- Threaded eventReplyContext from incoming event through slow-path dispatch in router.ts
- All 22 existing router tests remain green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add eventReplyContext to EventRouterDeps and extend tool schemas** - `6906d8c` (feat)
2. **Task 2: Thread eventReplyContext through slow-path dispatch in router.ts** - `3dad688` (feat)

## Files Created/Modified
- `packages/agents/src/router/types.ts` - Added eventReplyContext optional field to EventRouterDeps interface
- `packages/agents/src/router/tools/signal-conversation.ts` - Added replyContext to input schema + auto-injection in execute
- `packages/agents/src/router/tools/start-conversation.ts` - Added replyContext to input schema + auto-injection in execute
- `packages/agents/src/router/router.ts` - Slow-path case creates slowPathDeps with eventReplyContext from routeDecision.event

## Decisions Made
- Auto-injection pattern: `inputReplyContext ?? deps.eventReplyContext` -- LLM-provided replyContext takes precedence over auto-injected
- Conditional spread `...(replyContext && { replyContext })` used in all four locations for exactOptionalPropertyTypes compliance
- Confirmed fast-path start/signal cases already forward replyContext from Phase 61 -- no duplicate wiring added

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Router tools now propagate replyContext through both fast-path and slow-path
- Ready for Plan 02 (additional router updates) and Plan 03

## Self-Check: PASSED

All 5 files found. Both commit hashes verified (6906d8c, 3dad688).

---
*Phase: 62-router-updates*
*Completed: 2026-02-08*
