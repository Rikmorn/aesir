---
phase: 20-testing-pyramid
plan: 04
subsystem: testing
tags: [msw, api-mocking, vitest, linear, github, slack]

# Dependency graph
requires:
  - phase: 20-02
    provides: Test utilities package structure
provides:
  - MSW server setup for API mocking
  - Default handlers for Linear GraphQL API
  - Default handlers for GitHub REST API
  - Default handlers for Slack Web API
  - setupMSW helper for vitest integration
affects: [20-05, 20-06, integration-tests]

# Tech tracking
tech-stack:
  added: [msw@2.12.7]
  patterns: [http-request-mocking, graphql-mocking, vitest-lifecycle-hooks]

key-files:
  created:
    - packages/test-utils/src/msw/server.ts
    - packages/test-utils/src/msw/index.ts
    - packages/test-utils/src/msw/handlers/linear.ts
    - packages/test-utils/src/msw/handlers/github.ts
    - packages/test-utils/src/msw/handlers/slack.ts
    - packages/test-utils/src/msw/handlers/index.ts
  modified:
    - packages/test-utils/package.json
    - packages/test-utils/src/index.ts

key-decisions:
  - "MSW v2.x for Node.js request interception"
  - "Handler-based routing for API mocking"
  - "Re-export http and HttpResponse for test overrides"
  - "setupMSW helper accepts vitest lifecycle hooks"
  - "onUnhandledRequest defaults to bypass"

patterns-established:
  - "MSW handler pattern: export individual and combined handler arrays"
  - "Mock data exports alongside handlers for test assertions"
  - "GraphQL routing via query pattern matching"

# Metrics
duration: 3min
completed: 2026-01-23
---

# Phase 20 Plan 04: MSW API Mocking Summary

**MSW v2.x with pre-configured handlers for Linear GraphQL, GitHub REST, and Slack Web APIs with vitest lifecycle integration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-23T21:40:04Z
- **Completed:** 2026-01-23T21:43:55Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Installed MSW v2.12.7 for Node.js request interception
- Created default handlers for all three external APIs (28 total handlers)
- Built setupMSW helper for simple vitest integration
- Exported mock data alongside handlers for test assertions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MSW dependency** - (already committed by parallel 20-03, MSW in package.json)
2. **Task 2: Create MSW handlers for external APIs** - `044e5cf` (feat)
3. **Task 3: Create MSW server setup and update exports** - `4516745` (feat)

## Files Created/Modified

- `packages/test-utils/package.json` - Added msw@2.12.7 to devDependencies
- `packages/test-utils/src/msw/server.ts` - MSW server setup with setupMSW helper
- `packages/test-utils/src/msw/index.ts` - Barrel exports for MSW utilities
- `packages/test-utils/src/msw/handlers/linear.ts` - Linear GraphQL API mocks
- `packages/test-utils/src/msw/handlers/github.ts` - GitHub REST API mocks
- `packages/test-utils/src/msw/handlers/slack.ts` - Slack Web API mocks
- `packages/test-utils/src/msw/handlers/index.ts` - Combined handler exports
- `packages/test-utils/src/index.ts` - Added MSW re-exports

## Decisions Made

1. **MSW v2.x selection**: Current stable version with Node.js support and type-safe handlers
2. **Handler export pattern**: Individual handler arrays (linearHandlers, etc.) plus combined allHandlers
3. **Mock data co-location**: Export mock data alongside handlers for test assertions
4. **GraphQL routing**: Pattern matching on query strings (vs introspection) for simplicity
5. **onUnhandledRequest default**: Set to "bypass" to allow non-mocked requests through

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **Task 1 already completed**: MSW was installed by parallel 20-03 execution, so package.json already had the dependency. Verified and proceeded.
2. **Biome formatting**: Pre-commit hooks required import sorting and formatting fixes. Resolved with lint:fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- MSW infrastructure ready for writing integration tests in 20-05 and 20-06
- All API handlers can be overridden per-test using server.use()
- Mock data available for assertion validation

---
*Phase: 20-testing-pyramid*
*Completed: 2026-01-23*
