---
phase: 75-echo-elimination
plan: 03
subsystem: api
tags: [webhook, dedup, echo-suppression, routing, pg-boss, vitest]

# Dependency graph
requires:
  - phase: 75-echo-elimination
    provides: "Webhook filter factory, actorInfo type, echo env config (Plan 01)"
  - phase: 75-echo-elimination
    provides: "Actor metadata in NormalizedEvent payloads (Plan 02)"
provides:
  - "actorInfo extraction in Linear, GitHub, and Slack adapters"
  - "Webhook filter wired into routeEvent() between adapter pipeline and task routing"
  - "pg-boss hourly dedup cleanup job (24h TTL)"
  - "TimeoutScheduler.getBoss() for shared pg-boss job scheduling"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional actorInfo spread: ...(actorInfo && { actorInfo }) for conditional echo detection"
    - "pg-boss cron scheduling for cleanup jobs via boss.schedule()"
    - "Shared pg-boss instance via TimeoutScheduler.getBoss()"

key-files:
  created: []
  modified:
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/github.ts
    - packages/agents/src/adapters/slack.ts
    - packages/agents/src/adapters/linear.test.ts
    - packages/agents/src/adapters/github.test.ts
    - packages/agents/src/adapters/slack.test.ts
    - packages/agents/src/router/router.ts
    - packages/agents/src/router/types.ts
    - packages/agents/src/service/main.ts
    - packages/agents/src/framework/timeout-scheduler.ts
    - packages/agents/src/framework/timeout-scheduler.test.ts
    - packages/agents/src/framework/conversation-executor.test.ts
    - packages/agents/src/framework/worker-loop.test.ts

key-decisions:
  - "Block action events (approval, escalation) excluded from Slack actorInfo -- user-initiated by definition"
  - "pg-boss schedule:true enables cron for dedup cleanup while keeping send+startAfter for timeouts"
  - "getBoss() returns undefined before start() to prevent premature job scheduling"

patterns-established:
  - "Webhook filter injection via RouteEventDeps -- optional dependency, no breaking changes"
  - "Shared pg-boss instance access pattern via getBoss() on TimeoutScheduler"

requirements-completed: [ECHO-01, ECHO-02, ECHO-03]

# Metrics
duration: 6min
completed: 2026-02-16
---

# Phase 75 Plan 03: Pipeline Wiring Summary

**Wire webhook dedup/echo filter into routeEvent() with adapter actorInfo extraction and pg-boss hourly cleanup**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-16T22:56:50Z
- **Completed:** 2026-02-16T23:03:14Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Linear adapter extracts actorType from payload, identifies OauthClient/application as bot actors
- GitHub adapter compares sender.login to GITHUB_APP_LOGIN config for bot detection with identifier tracking
- Slack adapter compares apiAppId to SLACK_APP_ID for Events API events; block actions excluded (user-initiated)
- Webhook filter runs in routeEvent() between adapter pipeline and task routing -- duplicates return "deduplicated", echoes return "ignored"
- pg-boss hourly cleanup job purges dedup entries older than 24h via TimeoutScheduler's shared boss instance
- 12 new adapter tests covering bot detection, non-bot pass-through, missing data fail-open, and config-missing fail-open
- All 757 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Adapter actorInfo extraction and tests** - `4f96013` (feat)
2. **Task 2: Router pipeline wiring, pg-boss cleanup, and bootstrap** - `85007a7` (feat)

## Files Created/Modified
- `packages/agents/src/adapters/linear.ts` - Extract actorType, populate actorInfo on all event cases
- `packages/agents/src/adapters/github.ts` - Extract sender, compare to GITHUB_APP_LOGIN config
- `packages/agents/src/adapters/slack.ts` - Extract apiAppId, compare to SLACK_APP_ID for Events API events only
- `packages/agents/src/adapters/linear.test.ts` - 4 actorInfo tests (OauthClient, application, user, missing)
- `packages/agents/src/adapters/github.test.ts` - 4 actorInfo tests (matching, non-matching, missing sender, missing config)
- `packages/agents/src/adapters/slack.test.ts` - 5 actorInfo tests (matching, non-matching, missing, block actions exclusion, missing config)
- `packages/agents/src/router/router.ts` - Insert filterWebhookEvent call between adapter pipeline and task routing
- `packages/agents/src/router/types.ts` - Add webhookFilter to RouteEventDeps interface
- `packages/agents/src/service/main.ts` - Create webhook filter, wire into route deps, schedule dedup cleanup
- `packages/agents/src/framework/timeout-scheduler.ts` - Add getBoss(), enable schedule:true, track started state
- `packages/agents/src/framework/timeout-scheduler.test.ts` - Update PgBoss options assertion (schedule: true)
- `packages/agents/src/framework/conversation-executor.test.ts` - Add getBoss to mock TimeoutScheduler
- `packages/agents/src/framework/worker-loop.test.ts` - Add getBoss to mock TimeoutScheduler

## Decisions Made
- Block action events (approval, escalation) are explicitly excluded from Slack actorInfo population because they are user-initiated by definition and should never be suppressed as echoes
- Enabled pg-boss `schedule: true` (was `schedule: false`) to support cron-based dedup cleanup. This has no impact on existing timeout scheduling which uses `send()` with `startAfter` (not cron)
- `getBoss()` returns undefined before `start()` is called to prevent premature job scheduling in bootstrap ordering edge cases

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added getBoss() to mock TimeoutSchedulers in test files**
- **Found during:** Task 2 (typecheck after adding getBoss to interface)
- **Issue:** 11 type errors in conversation-executor.test.ts and worker-loop.test.ts -- mock TimeoutScheduler objects missing the new getBoss method
- **Fix:** Added `getBoss: vi.fn().mockReturnValue(undefined)` to both mock factories
- **Files modified:** conversation-executor.test.ts, worker-loop.test.ts
- **Verification:** `pnpm --filter @aesir/agents run typecheck` passes
- **Committed in:** `85007a7` (Task 2 commit)

**2. [Rule 1 - Bug] Updated timeout-scheduler.test.ts assertion for schedule option**
- **Found during:** Task 2 (full test suite run)
- **Issue:** Test asserted `schedule: false` but we changed it to `schedule: true` for cron support
- **Fix:** Updated test description and assertion to match new `schedule: true` behavior
- **Files modified:** timeout-scheduler.test.ts
- **Verification:** `pnpm --filter @aesir/agents test` -- all 757 tests pass
- **Committed in:** `85007a7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes are direct consequences of the planned changes (new interface method and changed config option). No scope creep.

## Issues Encountered
None -- all changes applied cleanly after lint/format fixes.

## User Setup Required
None - no external service configuration required. GITHUB_APP_LOGIN and SLACK_APP_ID env vars were already added in Plan 01.

## Next Phase Readiness
- Phase 75 Echo Elimination is now complete: dedup table + filter (Plan 01), actor metadata threading (Plan 02), and pipeline wiring (Plan 03)
- Migration `pnpm db:migrate` is required before the dedup filter works in production
- The entire echo elimination pipeline is operational: adapters -> actorInfo -> webhookFilter -> routeEvent

## Self-Check: PASSED

All 13 modified files verified present. Both task commits (4f96013, 85007a7) confirmed in git log.

---
*Phase: 75-echo-elimination*
*Completed: 2026-02-16*
