---
phase: 47-cleanup-documentation
plan: 01
subsystem: infra
tags: [cleanup, barrel-exports, dead-code, typescript, refactoring]

# Dependency graph
requires:
  - phase: 46-pre-cleanup-verification
    provides: deletion manifest identifying all dead code and live-to-dead references
provides:
  - All barrel exports to dead code severed
  - Dead code fully isolated (no live file imports any dead file)
  - GATE A passed (typecheck + lint)
  - Ready for Phase B mass file deletion
affects: [47-02 (file deletion), 47-03 (dependency removal)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@ts-nocheck annotation on dead files pending deletion"

key-files:
  created: []
  modified:
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/index.ts
    - packages/agents/src/router/slow-path.ts
    - packages/agents/src/router/system-prompt.ts
    - packages/agents/src/router/tools/send-message.ts
    - packages/agents/src/shared/index.ts
    - packages/agents/src/shared/db/index.ts
    - packages/agents/src/shared/tools/index.ts
    - packages/agents/src/shared/tools/coordination/index.ts
    - packages/agents/src/dev-agent/index.ts
    - packages/agents/src/index.ts
    - packages/platform/src/index.ts
    - packages/platform/src/logging/index.ts
    - packages/types/src/index.ts

key-decisions:
  - "@ts-nocheck added to 14 dead files to unblock pre-commit hook (tsc -b compiles all files in tsconfig include glob)"
  - "Temporal logger export removed from platform logging barrel (dead -- only consumed by platform/temporal/worker.ts which is itself dead)"
  - "dev-agent/index.ts cleared to deprecation comment rather than deleted (Phase B handles deletion)"

patterns-established:
  - "@ts-nocheck with deletion-phase comment for dead code isolation"

# Metrics
duration: 10min
completed: 2026-02-03
---

# Phase 47 Plan 01: Refactor Live-to-Dead References Summary

**All barrel exports to dead code severed across 3 packages (agents, platform, types) -- 15 files refactored, 14 dead files annotated with @ts-nocheck, GATE A passed**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-03T19:01:11Z
- **Completed:** 2026-02-03T19:11:17Z
- **Tasks:** 2
- **Files modified:** 29 (15 barrel/source refactors + 14 dead file annotations)

## Accomplishments
- Removed all legacy router code (routeEventLegacy, RouterDeps, FastPathAction, RoutingRule, fast-path imports, legacy system prompt)
- Renamed ROUTER_SYSTEM_PROMPT_V2 to ROUTER_SYSTEM_PROMPT (only version remaining)
- Fixed send-message.ts type dependency: RouterDeps -> EventRouterDeps (critical for correctness after RouterDeps deletion)
- Cleaned 9 barrel files across agents, platform, and types packages to remove all dead code re-exports
- Added @ts-nocheck to 14 dead files to prevent cascading typecheck failures while files still exist

## Task Commits

Each task was committed atomically:

1. **Task 1: Clean router module** - `29580b7` (refactor)
2. **Task 2: Clean all barrel exports across packages** - `c02f27a` (refactor)

## Files Created/Modified

### Router Module (Task 1)
- `packages/agents/src/router/router.ts` - Removed routeEventLegacy, handleRoutingFailureLegacy, sendRoutingAlertLegacy; removed fast-path and legacy slow-path imports
- `packages/agents/src/router/types.ts` - Removed RouterDeps, SignalAction, StartAction, IgnoreAction, FastPathAction, RoutingRule, Temporal Client import
- `packages/agents/src/router/index.ts` - Clean barrel with only v2.3 exports (routeEvent, routeViaAgentLoopV2, formatEventForLLM, ROUTER_SYSTEM_PROMPT, EventRouterDeps, RouteEventDeps, RouteEventResult, RouteResult)
- `packages/agents/src/router/slow-path.ts` - Removed routeViaAgentLoop, legacy imports, updated to use renamed ROUTER_SYSTEM_PROMPT; removed unsafe RouterDeps cast
- `packages/agents/src/router/system-prompt.ts` - Deleted legacy Temporal-based prompt, renamed ROUTER_SYSTEM_PROMPT_V2 to ROUTER_SYSTEM_PROMPT
- `packages/agents/src/router/tools/send-message.ts` - Changed RouterDeps to EventRouterDeps

### Barrel Exports (Task 2)
- `packages/agents/src/shared/index.ts` - Removed temporal re-export
- `packages/agents/src/shared/db/index.ts` - Removed context-manager, cost-tracking, task-store, trace-recorder exports
- `packages/agents/src/shared/tools/index.ts` - Removed toolkits.ts re-export
- `packages/agents/src/shared/tools/coordination/index.ts` - Removed spawn-agent.ts re-export
- `packages/agents/src/dev-agent/index.ts` - Cleared to deprecation comment
- `packages/agents/src/index.ts` - Removed dev-agent and product-agent re-exports
- `packages/platform/src/index.ts` - Removed temporal re-export
- `packages/platform/src/logging/index.ts` - Removed temporal-logger exports
- `packages/types/src/index.ts` - Removed temporal types re-export

### Dead File Annotations (@ts-nocheck)
- 8 router dead files: fast-path.ts, fast-path.test.ts, main.ts, router.test.ts, slow-path.test.ts, tools/query-workflows.ts, tools/signal-workflow.ts, tools/start-workflow.ts
- 3 dev-agent dead files: api/webhooks/github-pr-review.ts, github-pr-review.test.ts, linear-agent-session.ts
- 2 platform dead files: temporal/worker.ts, temporal/workflows/approval-workflow.ts
- 1 agents dead file: shared/tools/toolkits.ts

## Decisions Made
- **@ts-nocheck for dead files:** The pre-commit hook runs `tsc -b` which compiles ALL files in the tsconfig include glob (`src/**/*`), not just files reachable from barrels. Dead files that import now-removed barrel exports fail the build. Adding `@ts-nocheck` with a "will be deleted in Phase 47 Plan B" comment is the minimal, safe fix that unblocks commits without modifying tsconfig or touching dead file logic. All annotated files will be deleted in Plan 02.
- **Temporal logger removed from platform logging barrel:** `createTemporalLogger` was only imported by `platform/temporal/worker.ts` which is itself dead code. Removing it keeps the logging barrel clean.
- **dev-agent/index.ts cleared to comment:** The file stays because the directory structure is preserved until Phase B deletion. Clearing exports prevents any accidental consumption.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @ts-nocheck to 14 dead files to unblock commits**
- **Found during:** Task 1 and Task 2 (commit attempts)
- **Issue:** Pre-commit hook runs `tsc -b` (full build) which picks up dead files via tsconfig `include: ["src/**/*"]`. Dead files import types/functions removed from barrels, causing typecheck failures.
- **Fix:** Added `// @ts-nocheck -- Dead code: will be deleted in Phase 47 Plan B` to all 14 affected dead files
- **Files modified:** 8 router files, 3 dev-agent webhook files, 2 platform temporal files, 1 toolkits file
- **Verification:** `pnpm typecheck` passes with zero errors; `pnpm -r build` passes clean
- **Committed in:** 29580b7 (Task 1, 8 router files) and c02f27a (Task 2, 6 additional files)

**2. [Rule 3 - Blocking] Platform temporal/workflows/approval-workflow.ts cascading break**
- **Found during:** Task 2 (commit attempt)
- **Issue:** Removing `@aesir/types` temporal barrel caused `BoundActivities` import to fail in platform's dead approval workflow
- **Fix:** Added @ts-nocheck to approval-workflow.ts
- **Committed in:** c02f27a (Task 2)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both fixes were necessary to pass the pre-commit hook. No scope creep -- all annotated files are confirmed dead code that will be deleted in Plan 02.

## Issues Encountered
- Pre-commit hook runs full build (`tsc -b`) not just `tsc --noEmit`, causing dead file compilation failures. Resolved via @ts-nocheck annotations. This was anticipated by the plan's verification section but the hook's strictness required the additional annotation step.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All dead code is now fully isolated from live code via barrel export removal
- 14 dead files annotated with @ts-nocheck are ready for mass deletion in Plan 02 (Phase B)
- GATE A verification passes: typecheck clean, lint clean (pre-existing naming convention errors only)
- No blockers for Plan 02

---
*Phase: 47-cleanup-documentation*
*Completed: 2026-02-03*
