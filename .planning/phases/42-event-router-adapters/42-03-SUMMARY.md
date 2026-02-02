---
phase: 42-event-router-adapters
plan: 03
subsystem: agents
tags: [event-router, routing, discriminated-union, conversation-id, signal-routing]

# Dependency graph
requires:
  - phase: 42-01
    provides: "IncomingEvent type, adapters, IGNORE_EVENT_TYPES set"
  - phase: 42-02
    provides: "EventRouterDeps, conversation-based router tools, domain-language signal types"
  - phase: 39
    provides: "AgentRegistry with list() and triggers support"
provides:
  - "EventRouter factory (createEventRouter) with synchronous handle() routing"
  - "EventRouterRouteResult discriminated union (start/signal/ignore/slow_path)"
  - "Start rules loaded dynamically from AgentRegistry triggers"
  - "Signal routing via SIGNAL_AGENT_MAP to correct conversation IDs"
affects: [phase-43-webhook-handler, phase-44-worker-entrypoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synchronous routing decision with async initialization (loadStartRules)"
    - "Discriminated union for routing outcomes"
    - "Correlation-based conversation ID formula: {agentDefinitionId}-{correlationKey}"

key-files:
  created:
    - packages/agents/src/framework/event-router.ts
    - packages/agents/src/framework/event-router.test.ts
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/index.ts

key-decisions:
  - "SIGNAL_AGENT_MAP as static Record for signal-to-agent resolution -- simple, sufficient for current 2-agent system"
  - "handle() is synchronous (no I/O) -- all async work happens in loadStartRules()"
  - "Missing correlationKey on start/signal events falls to slow_path (not error) -- graceful degradation"
  - "Duplicate trigger registrations log warning and first-wins -- deterministic behavior"

patterns-established:
  - "EventRouter pattern: async init + sync routing decision"
  - "Conversation ID formula: {agentDefinitionId}-{correlationKey}"

# Metrics
duration: 5min
completed: 2026-02-02
---

# Phase 42 Plan 03: EventRouter Summary

**EventRouter with synchronous handle() producing start/signal/ignore/slow_path discriminated union from AgentRegistry triggers and SIGNAL_AGENT_MAP**

## Performance

- **Duration:** 5m05s
- **Started:** 2026-02-02T21:20:36Z
- **Completed:** 2026-02-02T21:25:41Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- EventRouter interface and RouteResult discriminated union added to framework types
- createEventRouter factory with synchronous handle() method producing four routing outcomes
- Start rules loaded dynamically from AgentRegistry.list() triggers (not hardcoded)
- Signal routing via SIGNAL_AGENT_MAP maps domain signal types to correct agent conversation IDs
- 27 tests covering all routing paths, edge cases, and loadStartRules refresh behavior
- Zero regressions across 900 existing agent tests

## Task Commits

Each task was committed atomically:

1. **Task 1: EventRouter interface in framework types** - `34168bd` (feat)
2. **Task 2: EventRouter implementation and tests** - `1590a36` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `packages/agents/src/framework/types.ts` - Added EventRouterRouteResult, EventRouterOptions, EventRouter interface
- `packages/agents/src/framework/event-router.ts` - createEventRouter factory with handle() and loadStartRules()
- `packages/agents/src/framework/event-router.test.ts` - 27 tests covering all routing paths
- `packages/agents/src/framework/index.ts` - Added createEventRouter barrel export

## Decisions Made
- SIGNAL_AGENT_MAP as static Record mapping domain signal types (approval, pr_merged, etc.) to agent IDs -- simple lookup, sufficient for current 2-agent system. Can be made registry-driven if more agents are added.
- handle() is synchronous with no I/O -- all async work isolated in loadStartRules(). This keeps the hot path fast and deterministic.
- Missing correlationKey on start/signal events gracefully degrades to slow_path instead of throwing -- lets the LLM slow-path router try to resolve these events.
- Duplicate trigger registrations (two agents claiming same event type) log a warning and first-wins -- deterministic behavior avoids non-obvious routing changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome pre-commit hook caught unused imports (PinoLogger, AgentRegistry) in event-router.ts and formatting issues in the test file. Fixed inline before successful commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 42 is now complete (all 3 plans done)
- EventRouter, adapters, and router tools provide the full routing pipeline
- Ready for Phase 43 (webhook handler integration) to wire EventRouter into HTTP endpoint
- EventRouter.loadStartRules() should be called at service startup and optionally refreshed on definition file changes

---
*Phase: 42-event-router-adapters*
*Completed: 2026-02-02*
