---
phase: 20-testing-pyramid
plan: 06
subsystem: testing
tags: [testcontainers, postgres, integration-tests, credential-store, drizzle]

# Dependency graph
requires:
  - phase: 20-02
    provides: Test utilities package with factories, mocks, and mock logger
  - phase: 20-03
    provides: Testcontainers utilities with setupPostgresContainer
provides:
  - Linear schema migration SQL for test databases
  - Example integration test demonstrating testcontainers pattern
  - Replicable pattern for other credential store integration tests
affects: [testing, 21-ci-cd, github-integration-tests, slack-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cleanup-based test isolation with unique IDs + afterEach cleanup"
    - "Config mocking pattern for integration tests"
    - "postgres.js for drizzle in testcontainers"

key-files:
  created:
    - packages/test-utils/src/migrations/linear.ts
    - packages/test-utils/src/migrations/index.ts
    - packages/integrations/linear/src/db/credential-store.integration.test.ts
  modified:
    - packages/test-utils/src/index.ts
    - packages/integrations/linear/package.json
    - package.json

key-decisions:
  - "Cleanup-based isolation over transaction isolation (simpler, avoids driver mismatch)"
  - "Unique workspace IDs per test for reliable cleanup"
  - "Type assertion for MockLogger (as unknown as PinoLogger)"
  - "postgres.js driver added to Linear devDependencies for drizzle"

patterns-established:
  - "Integration test naming: *.integration.test.ts (excluded from test:fast)"
  - "vi.mock config before imports pattern for preventing env validation"
  - "Container shared across suite (beforeAll), cleanup per test (afterEach)"

# Metrics
duration: 6min
completed: 2026-01-23
---

# Phase 20 Plan 06: Integration Test Example Summary

**Testcontainers integration test for Linear credential store with cleanup-based isolation pattern**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-23T21:46:37Z
- **Completed:** 2026-01-23T21:52:56Z
- **Tasks:** 3 (Task 2 was already done by parallel 20-05)
- **Files modified:** 6

## Accomplishments
- Created Linear schema migration SQL helper for test databases
- Created comprehensive integration test for LinearCredentialStore
- Established replicable pattern for credential store testing
- Verified test isolation works via unique IDs + afterEach cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration SQL helper** - `1dd2830` (feat)
2. **Task 2: Add test-utils dependency** - Already done by 20-05
3. **Task 3: Create integration test** - `efcbea5` (feat)

## Files Created/Modified
- `packages/test-utils/src/migrations/linear.ts` - Linear schema SQL (credentials, webhook_deliveries, mcp_tool_permissions)
- `packages/test-utils/src/migrations/index.ts` - Barrel export for migrations
- `packages/test-utils/src/index.ts` - Added migrations export
- `packages/integrations/linear/src/db/credential-store.integration.test.ts` - Full integration test suite
- `packages/integrations/linear/package.json` - Added postgres driver
- `package.json` - Added test:fast and test:integration scripts

## Decisions Made
- **Cleanup-based isolation:** Used unique workspace IDs per test with afterEach DELETE instead of transaction isolation. This avoids complexity of sharing postgres.js transaction context with drizzle and is simpler to understand.
- **MockLogger type assertion:** The MockLogger doesn't implement full pino.Logger interface, so we use `as unknown as PinoLogger` pattern (same as existing unit tests).
- **postgres driver in devDependencies:** Added postgres.js to Linear package for creating drizzle connection in tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added test:fast and test:integration scripts**
- **Found during:** Task 1
- **Issue:** These scripts were mentioned in RESEARCH.md but not yet committed
- **Fix:** Added scripts to root package.json
- **Files modified:** package.json
- **Committed in:** 1dd2830 (Task 1 commit)

**2. [Rule 3 - Blocking] Added postgres driver to Linear devDependencies**
- **Found during:** Task 3 (typecheck failure)
- **Issue:** TypeScript couldn't find 'postgres' module in integration test
- **Fix:** Added postgres@^3.4.7 to devDependencies
- **Files modified:** packages/integrations/linear/package.json, pnpm-lock.yaml
- **Committed in:** efcbea5 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both blocking fixes necessary for tests to compile and run. No scope creep.

## Issues Encountered
- Task 2 (add test-utils dependency) was already completed by parallel wave plan 20-05, so no commit was needed for that task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Integration test pattern established and can be replicated for GitHub and Slack credential stores
- Docker required to run integration tests (test:integration command)
- Pattern documented via working example in LinearCredentialStore

---
*Phase: 20-testing-pyramid*
*Completed: 2026-01-23*
