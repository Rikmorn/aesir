---
phase: 16-linear-extraction
plan: 06
subsystem: integrations
tags: [express, webhook, oauth, linear, http-server]

# Dependency graph
requires:
  - phase: 16-02
    provides: Database credential store for Linear tokens
  - phase: 16-03
    provides: Webhook signature verification and parser
  - phase: 16-04
    provides: LinearClient factory with OAuth config
  - phase: 16-05
    provides: Token store and OAuth flow helpers
provides:
  - Express HTTP server with webhook and OAuth routes
  - Raw body middleware for signature verification
  - Graceful shutdown handling
affects: [16-07-containerization, 16-08-deployment]

# Tech tracking
tech-stack:
  added: [express, @types/express]
  patterns: [express-raw-body-webhook, oauth-csrf-state, graceful-shutdown]

key-files:
  created:
    - packages/integrations/linear/src/api/webhooks.ts
    - packages/integrations/linear/src/api/oauth.ts
    - packages/integrations/linear/src/api/routes.ts
    - packages/integrations/linear/src/api/index.ts
    - packages/integrations/linear/src/main.ts
  modified:
    - packages/integrations/linear/src/index.ts
    - packages/integrations/linear/src/oauth/flow.ts

key-decisions:
  - "express.raw middleware for webhook signature verification before JSON parsing"
  - "In-memory state storage for OAuth CSRF protection (single-instance MVP)"
  - "Dynamic import of saveLinearTokens to avoid circular dependency during parallel execution"
  - "Conditional property assignment for exactOptionalPropertyTypes compliance"

patterns-established:
  - "Pattern: Raw body middleware (express.raw) before webhook routes"
  - "Pattern: CSRF state parameter with TTL cleanup for OAuth flows"
  - "Pattern: Graceful shutdown with 10s timeout on SIGTERM/SIGINT"
  - "Pattern: Health check endpoint at /health"

# Metrics
duration: 5min
completed: 2026-01-21
---

# Phase 16 Plan 06: HTTP API Layer Summary

**Express HTTP server with webhook signature verification, OAuth CSRF protection, and graceful shutdown for containerized deployment**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-21T18:56:37Z
- **Completed:** 2026-01-21T19:02:10Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- HTTP server entry point ready for containerization
- Webhook handler with timing-safe signature verification
- OAuth flow with state parameter CSRF protection
- Graceful shutdown with 10-second timeout

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook and OAuth route handlers** - `4b88951` (feat) - Includes fixes for parallel 16-05 execution
2. **Task 2: Create routes aggregation and main entry point** - `3ef6f2c` (feat)

## Files Created/Modified

**Created:**
- `packages/integrations/linear/src/api/webhooks.ts` - Webhook route with signature verification and AgentSession event handling
- `packages/integrations/linear/src/api/oauth.ts` - OAuth authorize and callback routes with CSRF protection
- `packages/integrations/linear/src/api/routes.ts` - Combined router mounting webhook and OAuth routes
- `packages/integrations/linear/src/api/index.ts` - API module barrel export
- `packages/integrations/linear/src/main.ts` - Express server entry point with graceful shutdown

**Modified:**
- `packages/integrations/linear/src/index.ts` - Added API exports
- `packages/integrations/linear/src/oauth/flow.ts` - Fixed exactOptionalPropertyTypes for updateTokens (from parallel 16-05)

## Decisions Made

**1. express.raw middleware for signature verification**
- **Rationale:** HMAC signature verification requires raw body bytes. Using express.json() would parse the body and break signature verification (Pitfall 1 from RESEARCH.md).
- **Implementation:** `app.use(express.raw({ type: "application/json" }))` in main.ts before routes

**2. In-memory OAuth state storage**
- **Rationale:** Single-instance MVP doesn't require Redis. State is cleaned up after 10 minutes via setInterval.
- **Future:** Consider Redis for multi-instance deployments

**3. Dynamic import of saveLinearTokens**
- **Rationale:** Avoided circular dependency during parallel execution of 16-05 and 16-06
- **Implementation:** `await import("../oauth/token-store.js")` in OAuth callback handler

**4. Conditional property assignment for exactOptionalPropertyTypes**
- **Rationale:** TypeScript exactOptionalPropertyTypes flag prevents assigning `T | undefined` to optional `T?` properties
- **Implementation:** Build object with required fields, conditionally add optional fields only if defined

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes violation in oauth/flow.ts**
- **Found during:** Task 1 commit (pre-commit hook caught build error)
- **Issue:** Plan 16-05 created oauth/flow.ts with `expiresAt: new Date(newConfig.expiresAt)` where expiresAt could be undefined, violating exactOptionalPropertyTypes
- **Fix:** Conditionally build tokens object with optional fields only when defined
- **Files modified:** packages/integrations/linear/src/oauth/flow.ts
- **Verification:** `pnpm --filter @aesir/integration-linear typecheck` passes
- **Committed in:** 4b88951 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Biome lint violations in parallel 16-05 files**
- **Found during:** Task 1 commit (pre-commit hook)
- **Issue:** Files created by parallel plan 16-05 had import organization and formatting issues
- **Fix:** Applied Biome auto-fixes to oauth/flow.ts and oauth/index.ts
- **Files modified:** packages/integrations/linear/src/oauth/flow.ts, packages/integrations/linear/src/oauth/index.ts
- **Verification:** Biome check passes
- **Committed in:** 4b88951 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both from parallel plan 16-05 execution)
**Impact on plan:** Deviations were fixes for parallel plan 16-05, not changes to 16-06 scope. No scope creep.

## Issues Encountered

**Parallel plan execution type errors:**
- **Issue:** Plans 16-05 and 16-06 ran in parallel (both in wave 3). Task 1 attempted to commit, but 16-05 files had type errors due to exactOptionalPropertyTypes.
- **Resolution:** Fixed type errors in 16-05 files as part of 16-06 Task 1 commit. This is expected behavior for parallel execution and follows Rule 1 (auto-fix bugs).
- **Lesson:** Parallel execution requires handling type errors from sibling plans. This is working as designed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for containerization (16-07):**
- main.ts entry point exists
- Graceful shutdown implemented
- Health check endpoint available
- Environment variables validated at startup

**Ready for deployment (16-08):**
- Webhook signature verification production-ready
- OAuth flow complete with CSRF protection
- Logging integrated (pino)

**No blockers.**

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
