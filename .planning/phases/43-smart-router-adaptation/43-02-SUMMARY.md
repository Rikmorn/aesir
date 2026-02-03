---
phase: 43-smart-router-adaptation
plan: 02
subsystem: agents
tags: [router, event-routing, conversation-executor, adapter-pipeline, idempotent]

# Dependency graph
requires:
  - phase: 42-event-router-adapters
    provides: EventRouter, routeViaAgentLoopV2, conversation tools, ROUTER_SYSTEM_PROMPT_V2
  - phase: 43-01
    provides: Complete adapter coverage (ALL_ADAPTERS, adaptPassThrough)
  - phase: 40
    provides: ConversationExecutor interface
provides:
  - "routeEvent() v2.3 pipeline: adapter -> EventRouter -> ConversationExecutor"
  - RouteEventDeps and RouteEventResult types
  - routeEventLegacy (preserved for Phase 47 cleanup)
  - 11 new tests for the v2.3 pipeline
affects: [44 (router/main.ts wiring), 47 (cleanup of routeEventLegacy and old fast-path)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adapter pipeline with pass-through fallback (never-null guarantee)"
    - "Fire-and-forget slow-path via void promise.catch()"
    - "Idempotent conversation start detection (executor returns existing ID)"
    - "Generic Slack alerts without stack traces for ops security"

key-files:
  created: []
  modified:
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/index.ts
    - packages/agents/src/router/main.ts
    - packages/agents/src/router/router.test.ts

decisions:
  - id: "43-02-01"
    title: "Idempotent start detection via conversation ID comparison"
    context: "executor.start() is idempotent (EXEC-10) but returns existing conversation ID. Need to distinguish new vs idempotent starts for logging."
    decision: "Compare returned conversationId with expected conversationId from EventRouter. Different ID means idempotent return."
    alternatives: ["Add explicit return type flag to executor.start()", "Always log as new start"]
    rationale: "Minimal change, works with existing executor interface. No executor modifications needed."

  - id: "43-02-02"
    title: "Helper functions use deps.logger instead of child logger parameter"
    context: "Pino child() returns Logger<never> which is not assignable to Logger<string> parameter type."
    decision: "Pass deps to helper functions and use deps.logger with explicit eventId/eventType context fields."
    alternatives: ["Cast child logger as PinoLogger", "Use generic type parameter"]
    rationale: "Matches legacy pattern (handleRoutingFailureLegacy uses deps.logger), avoids type casting."

metrics:
  duration: "8m23s"
  completed: "2026-02-03"
---

# Phase 43 Plan 02: Router Adaptation Pipeline Summary

Replaced routeEvent() with the v2.3 adapter -> EventRouter -> ConversationExecutor pipeline, connecting all Phase 42 building blocks and Phase 40's executor into a single entry point.

## What Was Built

### New routeEvent() Pipeline (router.ts)

The new `routeEvent()` function implements a three-stage pipeline:

1. **Adapter pipeline**: Iterates `ALL_ADAPTERS` (Slack, GitHub, Linear), takes first non-null result. Falls back to `adaptPassThrough()` if none match. This guarantees every `NormalizedEvent` gets transformed to an `IncomingEvent`.

2. **EventRouter**: Calls `deps.eventRouter.handle(incomingEvent)` for deterministic routing decisions. Returns one of: `start`, `signal`, `slow_path`, `ignore`.

3. **Dispatch**:
   - `start` -> `deps.executor.start()` with agentDefinitionId, correlationKey, and initialMessage only (NO MCP enrichment)
   - `signal` -> `deps.executor.signal()` with conversationId and signal payload
   - `slow_path` -> Fire-and-forget `void routeViaAgentLoopV2().catch()` (returns 200 immediately)
   - `ignore` -> Log at debug level, return immediately

### RouteEventDeps and RouteEventResult Types (types.ts)

- `RouteEventDeps`: Superset of `EventRouterDeps` -- includes `executor`, `eventRouter`, `logger`, optional `alertsChannel` and `linearTeamId`. TypeScript structural typing means it satisfies `EventRouterDeps` for passing to `routeViaAgentLoopV2()`.
- `RouteEventResult`: Unified response body with `received: true`, `action` discriminator, and optional `conversationId`.

### Legacy Code Preservation

- Old `routeEvent` renamed to `routeEventLegacy` with `@deprecated` JSDoc
- Old helper functions renamed to `handleRoutingFailureLegacy` and `sendRoutingAlertLegacy`
- `router/main.ts` updated to import and call `routeEventLegacy` -- compiles cleanly
- All existing tests updated to use `routeEventLegacy`

### Key Design Decisions

- **No MCP enrichment**: executor.start() receives only `initialMessage` (a simple string from the adapter like "Resolve Linear issue ABC-123: 'Add /healthz endpoint'"). Agents fetch their own context using their tools. This removes the v2.2 anti-pattern where `executeFastPath()` called `callMcpTool(linear:get_issue)` before starting workflows.
- **Idempotent handling**: executor.start() is idempotent (EXEC-10). Returns existing conversation ID for same correlationKey. Both new and idempotent starts return `{ action: "started", conversationId }` -- no alerts for idempotent results.
- **Signal handling**: executor.signal() returns discriminated action (resumed/queued/rejected/deduplicated). Rejected signals logged at warn level. Deduplicated signals logged at info level. Neither triggers Slack alerts.
- **Generic alerts**: Only actual infrastructure failures trigger Slack alerts. Alert messages are generic ("Something went wrong processing event...Check logs.") with no stack traces or error details.
- **Fire-and-forget slow path**: `void routeViaAgentLoopV2(event, deps).catch(...)` returns 200 immediately. Background failures logged and alerted independently.

## Test Coverage

11 new tests in `routeEvent (v2.3)` describe block:

| Test | Validates |
|------|-----------|
| routes start action via executor.start() | Start path, correct params, no MCP calls |
| routes signal action via executor.signal() | Signal path, correct signal payload |
| returns classifying for slow_path | Fire-and-forget, immediate return |
| returns ignored for ignore action | Ignore path, debug logging |
| falls through to pass-through adapter | Adapter pipeline fallback |
| returns error and sends alert on executor failure | Error handling, Slack alert |
| does not alert on idempotent signal results | Deduplicated signal, info log only |
| does not alert on idempotent start results | Idempotent start, info log only |
| sends generic alert without stack traces | No error details in Slack message |
| does not call MCP enrichment before executor.start() | Key regression test for v2.2 anti-pattern |
| uses first matching adapter from ALL_ADAPTERS | Adapter pipeline order |

Total test counts: 70 router tests, 35 adapter tests -- all passing.

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 1341c82 | feat | Replace routeEvent() with adapter -> EventRouter -> executor pipeline |
| 849519f | test | Add comprehensive tests for v2.3 routeEvent() pipeline |

## Next Phase Readiness

Phase 43 is now complete (both plans). The router module has:
- Complete adapter coverage for all 18 event types (43-01)
- New routeEvent() pipeline using ConversationExecutor (43-02)
- Legacy code preserved as routeEventLegacy for Phase 47 cleanup

Ready for Phase 44 (router/main.ts wiring to use the new routeEvent with real dependencies).
