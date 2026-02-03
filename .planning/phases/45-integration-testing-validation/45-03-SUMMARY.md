---
phase: 45-integration-testing-validation
plan: 03
subsystem: testing
tags: [supertest, express, http, integration-tests, e2e-checklist, vitest, testcontainers]

# Dependency graph
requires:
  - phase: 45-integration-testing-validation
    plan: 01
    provides: shared integration test infrastructure (setup.ts, helpers.ts, testcontainer lifecycle)
  - phase: 43-event-routing
    provides: adapters, EventRouter, routeEvent() pipeline
  - phase: 44-single-service-consolidation
    provides: unified service/main.ts with Express route handlers

provides:
  - HTTP layer integration tests validating full Express routing pipeline
  - Manual E2E validation checklist for real webhook testing
  - MockFn type fix for vitest 4.x compatibility in test helpers

affects:
  - phase: 47-cleanup
    how: E2E checklist documents current system behavior before legacy cleanup

# Tech tracking
tech-stack:
  added: []
  patterns:
    - supertest against Express app with test-injected dependencies
    - Structural MockFn type alias to avoid vitest generic type variance issues

# File tracking
key-files:
  created:
    - packages/agents/src/framework/__integration__/http-layer.integration.test.ts
    - .planning/phases/45-integration-testing-validation/E2E-CHECKLIST.md
  modified:
    - packages/agents/src/framework/__integration__/helpers.ts

# Decisions
key-decisions:
  - id: HTTP_TEST_APP_PATTERN
    decision: Build test Express app replicating service/main.ts routes rather than importing production entry point
    reason: Production main.ts calls process.exit on env validation and starts listening -- unsuitable for supertest
  - id: MOCKFN_STRUCTURAL_TYPE
    decision: Replace vitest Mock import with structural MockFn interface in helpers.ts
    reason: vitest 4.x Mock<Procedure | Constructable> not assignable to bare Mock -- structural typing avoids the variance issue

# Metrics
duration: 6m36s
completed: 2026-02-03
---

# Phase 45 Plan 03: HTTP Layer & E2E Checklist Summary

HTTP layer integration tests via supertest validating Express routing, Zod validation, adapter pipeline, and EventRouter decisions with real PostgreSQL. Manual E2E checklist for real webhook validation.

## Performance

- **Duration**: 6m36s
- **Test count**: 16 HTTP layer tests, all passing
- **Test execution time**: ~2s (after container startup)

## Accomplishments

### HTTP Layer Integration Tests (16 tests)

Built a test Express app that mirrors `service/main.ts` route handlers but with test-injected dependencies (executor, eventRouter, logger). Tests validate the full request pipeline without starting a real HTTP server.

**GET /health** (1 test):
- Returns 200 with `{status: "ok", service: "agent-service"}`

**POST /events** (8 tests):
- Creates conversation from valid Linear `agent_session.created` event
- Creates conversation from valid Slack `app_mention.created` event
- Routes signal events via HTTP (Slack approval button -> signal delivery -> resume)
- Returns idempotent response for duplicate start events (same correlationKey)
- Ignores events in `IGNORE_EVENT_TYPES` (e.g., `linear.issue.created`)
- Rejects invalid payload with 400 and Zod issues
- Rejects empty body with 400
- Rejects malformed event id (missing `evt_` prefix) with 400
- Rejects invalid source (e.g., `jira`) with 400

**GET /conversations/:id** (3 tests):
- Returns conversation info for existing conversation
- Returns 404 for non-existent conversation
- Reflects status changes after worker execution (queued -> completed)

**POST /conversations/:id/cancel** (3 tests):
- Cancels an active conversation (returns 200)
- Returns 409 for already-completed conversation
- Returns 409 for already-cancelled conversation

### Manual E2E Validation Checklist (242 lines)

Comprehensive step-by-step checklist for validating the v2.3 framework with real webhooks:
- Prerequisites and known limitations
- v2.2 vs v2.3 comparison table
- Flow 1: Dev Agent (Linear issue -> approval -> PR)
- Flow 2: Product Agent (Slack mention -> Linear issue)
- Flow 3: Edge cases (duplicate events, cancel, ignored events, invalid payloads, health check)
- Troubleshooting table with 9 common failure modes
- Results tracking table

### MockFn Type Fix (Deviation)

Fixed pre-existing TypeScript type error in `helpers.ts` where vitest 4.x `Mock<Procedure | Constructable>` was not assignable to bare `Mock`. Replaced with structural `MockFn` interface that both `vi.fn()` return values and `ReturnType<typeof vi.fn>` satisfy. This fixed 9 type errors across both integration test files.

## Task Commits

| # | Task | Commit | Key Change |
|---|------|--------|------------|
| 1 | HTTP layer integration tests via supertest | `74217d2` | 16 supertest tests + MockFn type fix |
| 2 | Create manual E2E validation checklist | `398afe8` | 242-line step-by-step checklist |

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `packages/agents/src/framework/__integration__/http-layer.integration.test.ts` | HTTP layer integration tests | ~350 |
| `.planning/phases/45-integration-testing-validation/E2E-CHECKLIST.md` | Manual E2E validation checklist | 242 |

## Files Modified

| File | Change |
|------|--------|
| `packages/agents/src/framework/__integration__/helpers.ts` | Replace vitest `Mock` with structural `MockFn` type |

## Decisions Made

1. **Test Express app pattern**: Build a test Express app replicating `service/main.ts` routes rather than importing the production entry point. The production `main.ts` calls `process.exit()` on env validation failure and starts listening on a port, making it unsuitable for supertest.

2. **MockFn structural type**: Replace vitest `Mock` import with a structural `MockFn` interface. In vitest 4.x, `vi.fn()` returns `Mock<Procedure | Constructable>` which is not assignable to the bare `Mock` type due to generic variance. A structural interface with `mockResolvedValue`, `mockImplementation`, and `mockReset` methods sidesteps the issue entirely.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vitest 4.x Mock type incompatibility in helpers.ts**
- **Found during:** Task 1 (pre-commit hook typecheck)
- **Issue:** `Mock<Procedure | Constructable>` (from `vi.fn()`) not assignable to bare `Mock` (from helpers.ts parameter types). Pre-existing issue from 45-01 that affected both lifecycle-flows and http-layer test files (9 total type errors).
- **Fix:** Replaced `import type { Mock } from "vitest"` with structural `MockFn` interface using `any` for `mockImplementation` parameter type.
- **Files modified:** `packages/agents/src/framework/__integration__/helpers.ts`
- **Commit:** `74217d2`

## Issues & Risks

None.

## Next Phase Readiness

Phase 45 Plan 03 completes the HTTP layer testing and E2E checklist. The integration test suite now covers:
- **Plan 01**: Test infrastructure (setup, teardown, helpers, mock patterns)
- **Plan 02**: ConversationExecutor lifecycle flows (4 flows)
- **Plan 03**: HTTP layer via supertest (16 tests) + manual E2E checklist

All 20 integration tests pass. The manual E2E checklist is ready for real webhook validation.
