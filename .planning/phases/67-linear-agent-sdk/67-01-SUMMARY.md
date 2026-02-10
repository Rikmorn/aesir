---
phase: 67-linear-agent-sdk
plan: 01
subsystem: auth
tags: [oauth, token-refresh, linear, middleware, mutex]

# Dependency graph
requires: []
provides:
  - "Dual-layer token refresh middleware (proactive timer + reactive 401 retry)"
  - "refreshOAuthToken with retry/backoff (3 attempts, 1s/2s/4s)"
  - "Refresh coalescing via module-level mutex"
  - "Non-transient failure detection with Slack ops alerting"
affects: [67-02-actor-app-migration, 67-03-agent-activities]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level mutex for concurrent refresh coalescing"
    - "Proactive timer with setTimeout chain (not setInterval) for non-overlapping checks"
    - "Non-transient error detection with fast-fail (invalid_grant, 401)"

key-files:
  created:
    - packages/integrations/linear/src/client/refresh-middleware.ts
  modified:
    - packages/integrations/linear/src/client/factory.ts
    - packages/integrations/linear/src/client/index.ts
    - packages/integrations/linear/src/oauth/flow.ts
    - packages/integrations/linear/src/main.ts

key-decisions:
  - "Retry logic in both refreshOAuthToken (factory.ts) and refreshWithMutex (middleware) -- factory handles HTTP-level retry, middleware handles credential-level coordination"
  - "Proactive timer uses setTimeout chain instead of setInterval to prevent overlapping checks"
  - "Non-transient detection based on error message content (invalid_grant, non-transient marker) rather than error class hierarchy"
  - "Slack alerting is best-effort via MCP endpoint -- failure to alert never blocks token refresh flow"

patterns-established:
  - "withTokenRefresh<T> pattern: wrap any LinearClient operation for automatic 401 retry with fresh credentials"
  - "startProactiveRefresh returns { stop() } handle for lifecycle management on shutdown"

# Metrics
duration: 5min
completed: 2026-02-10
---

# Phase 67 Plan 01: Token Refresh Middleware Summary

**Dual-layer OAuth token refresh middleware with proactive 80% lifetime timer, reactive 401 retry, mutex-based refresh coalescing, and Slack ops alerting for revoked tokens**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T15:25:53Z
- **Completed:** 2026-02-10T15:31:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created `refresh-middleware.ts` with `withTokenRefresh` (reactive 401 retry) and `startProactiveRefresh` (timer-based proactive refresh at 80% token lifetime)
- Implemented `refreshWithMutex` to coalesce concurrent refresh attempts through a module-level mutex, preventing token race conditions
- Added retry with exponential backoff (1s, 2s, 4s) to `refreshOAuthToken` in factory.ts with non-transient error fast-fail
- Simplified `flow.ts` by removing the `onTokenRefresh` callback pattern -- refresh responsibility now lives in the middleware
- Wired proactive refresh timer into `main.ts` service lifecycle (start on boot, stop on shutdown)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create refresh-middleware.ts with dual-layer token refresh** - `5f39594` (feat)
2. **Task 2: Wire refresh middleware into flow.ts and main.ts** - `b2db59b` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/client/refresh-middleware.ts` - New dual-layer token refresh middleware (withTokenRefresh, startProactiveRefresh, refreshWithMutex, isAuthError, alertSlackOps)
- `packages/integrations/linear/src/client/factory.ts` - Added retry with backoff to refreshOAuthToken, non-transient error detection (invalid_grant, 401)
- `packages/integrations/linear/src/client/index.ts` - Barrel export for new refresh middleware types and functions
- `packages/integrations/linear/src/oauth/flow.ts` - Simplified: removed onTokenRefresh callback, credential store lookup, and refresh logic
- `packages/integrations/linear/src/main.ts` - Added proactive refresh timer start on boot and stop on shutdown

## Decisions Made
- **Retry at two levels:** `refreshOAuthToken` handles HTTP-level retries with backoff, while `refreshWithMutex` handles credential-level coordination and persistence. This separation keeps the factory function reusable while the middleware adds coordination.
- **setTimeout chain over setInterval:** Prevents overlapping checks if a single check takes longer than the interval. Each check completes before the next is scheduled.
- **Error message matching for non-transient detection:** Used string matching (`invalid_grant`, `(non-transient)`) rather than custom error classes. Pragmatic given that the Linear token endpoint returns standard OAuth error codes in the response body.
- **Best-effort Slack alerting:** The `alertSlackOps` function catches all errors internally. A failed alert should never prevent the refresh middleware from functioning or throw to callers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome pre-commit hook required formatting fixes (computed property access vs literal keys, multi-line formatting) and caught an unused import (`CredentialNotFoundError`) in simplified `flow.ts`. All resolved by running Biome's auto-fixer.

## User Setup Required
None - no external service configuration required. `SLACK_OPS_CHANNEL` and `SLACK_MCP_URL` are optional environment variables for alerting.

## Next Phase Readiness
- Token refresh infrastructure is complete and ready for actor=app migration in Plan 67-02
- MCP tool handlers can wrap calls with `withTokenRefresh` for 401 retry (follow-up in later plans)
- `createLinearClientFromDatabase` remains backward-compatible -- existing MCP tools continue to work unchanged

## Self-Check: PASSED

- All created files exist (refresh-middleware.ts, 67-01-SUMMARY.md)
- All modified files exist (factory.ts, index.ts, flow.ts, main.ts)
- All commit hashes verified (5f39594, b2db59b)

---
*Phase: 67-linear-agent-sdk*
*Completed: 2026-02-10*
