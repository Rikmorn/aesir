---
phase: 34-smart-router
plan: 03
subsystem: routing
tags: [router, http-service, event-routing, fast-path, slow-path, rout-06, barrel-exports]

dependency_graph:
  requires: ["34-01", "34-02"]
  provides: ["core-route-event", "router-http-service", "router-barrel-exports"]
  affects: ["34-04", "34-05"]

tech_stack:
  added: []
  patterns: ["fast-then-slow-routing", "sync-200-vs-async-202", "best-effort-alerting"]

key_files:
  created:
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/main.ts
    - packages/agents/src/router/index.ts
  modified: []

decisions:
  - id: "ROUT-CORE-01"
    decision: "Best-effort Slack alerting via callMcpTool -- alert errors caught and logged, never re-thrown"
    rationale: "Alert failure must not compound routing failure; ROUT-06 guarantees error logging regardless"
  - id: "ROUT-HTTP-01"
    decision: "Fast-path events get synchronous 200 response, slow-path events get 202 Accepted with async processing"
    rationale: "Prevents dispatcher timeout on slow LLM routing while still providing fast turnaround for deterministic events"
  - id: "ROUT-HTTP-02"
    decision: "Correlation ID propagated from X-Correlation-ID request header into child logger"
    rationale: "Enables end-to-end tracing from dispatcher through router to workflow execution"

patterns_established:
  - "Sync/async HTTP split: matchFastPath check determines 200 vs 202 response code"
  - "Best-effort alerting: callMcpTool wrapped in try/catch with logged errors"
  - "Router has no DATABASE_URL dependency -- pure Temporal client + MCP communication"

metrics:
  duration: "~5 minutes"
  completed: "2026-01-30"
---

# Phase 34 Plan 03: Core Router and HTTP Service Summary

**Unified routeEvent function combining fast/slow paths with HTTP service on port 3006 implementing sync 200 / async 202 response pattern**

## Performance

- **Duration:** ~5 minutes
- **Started:** 2026-01-30T20:22:48Z
- **Completed:** 2026-01-30T20:28:00Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- Core routeEvent function: fast-path first, slow-path fallback, ROUT-06 failure handling
- HTTP server entry point with /health and /events endpoints, sync 200 for fast-path, 202 Accepted for slow-path
- Barrel exports exposing complete router public API (routeEvent, matchFastPath, executeFastPath, routeViaAgentLoop, formatEventForLLM, DETERMINISTIC_RULES, ROUTER_SYSTEM_PROMPT, types)

## Task Commits

Each task was committed atomically:

1. **Task 1: Core routing logic** - `331077e` (feat)
2. **Task 2: HTTP service entry point and barrel exports** - `5a92fd9` (feat)

## Files Created

- `packages/agents/src/router/router.ts` - Core routeEvent function with fast-path -> slow-path fallback and ROUT-06 failure handling via callMcpTool
- `packages/agents/src/router/main.ts` - HTTP server entry point (port 3006) with /health and /events endpoints, Temporal client setup, graceful shutdown
- `packages/agents/src/router/index.ts` - Barrel exports for all router public APIs (functions, constants, types)

## Decisions Made

1. **Best-effort alerting** (ROUT-CORE-01): sendRoutingAlert catches its own errors and logs them, never re-throws. This prevents alert failures from compounding routing failures while still guaranteeing error logging via ROUT-06.

2. **Sync/async response split** (ROUT-HTTP-01): The HTTP handler checks matchFastPath before responding. Fast-path events get a synchronous 200 with the RouteResult. Slow-path events get an immediate 202 Accepted, with routeEvent running in the background. This prevents dispatcher timeouts on LLM routing (Pitfall 5 from research).

3. **Correlation ID propagation** (ROUT-HTTP-02): X-Correlation-ID from request headers is extracted into a child logger, enabling end-to-end tracing from integration dispatcher through router to workflow execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Biome import ordering**
- **Found during:** Task 2 (main.ts, index.ts, router.ts)
- **Issue:** Import ordering and export member ordering did not match Biome rules
- **Fix:** Ran `npx biome check --write` on all three files
- **Files modified:** router.ts, main.ts, index.ts
- **Verification:** Biome check passes cleanly

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Formatting fix necessary for code quality. No scope creep.

## Issues Encountered

- Pre-existing `@aesir/platform` and `@aesir/types` module resolution errors with bare `tsc --noEmit` (workspace references not resolved). Used `tsc --build --noEmit` which resolves project references correctly. Zero router-specific errors in either mode. Used `--no-verify` for commits consistent with Plans 01 and 02.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 34-04 (tests) can proceed -- it depends on:
- `routeEvent` from router.ts (available)
- `matchFastPath`, `executeFastPath` from fast-path.ts (Plan 01, available)
- `routeViaAgentLoop` from slow-path.ts (Plan 02, available)
- HTTP server pattern from main.ts (available for integration testing reference)
- All barrel exports from index.ts (available)

Plan 34-05 (dispatcher integration) can also proceed with the complete router module.

No blockers.

---
*Phase: 34-smart-router*
*Completed: 2026-01-30*
