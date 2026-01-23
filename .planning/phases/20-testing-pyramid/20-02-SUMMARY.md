---
phase: 20-testing-pyramid
plan: 02
subsystem: testing
tags: [vitest, test-utils, factories, mocks, neverthrow]

# Dependency graph
requires:
  - phase: 11-monorepo-setup
    provides: pnpm workspace structure
  - phase: 15-code-quality
    provides: ResultAsync patterns with neverthrow
provides:
  - "@aesir/test-utils package with factories and mocks"
  - "Deterministic test data generation via factory functions"
  - "MockLogger for log assertion in tests"
  - "MockCredentialStore for in-memory credential testing"
affects: [20-testing-pyramid, integration-tests, unit-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Counter-based deterministic IDs for test data"
    - "ResultAsync pattern for mock credential store"
    - "Factory function with options override pattern"

key-files:
  created:
    - packages/test-utils/package.json
    - packages/test-utils/tsconfig.json
    - packages/test-utils/vitest.config.ts
    - packages/test-utils/src/index.ts
    - packages/test-utils/src/factories/credentials.ts
    - packages/test-utils/src/factories/issues.ts
    - packages/test-utils/src/factories/index.ts
    - packages/test-utils/src/mocks/logger.ts
    - packages/test-utils/src/mocks/credential-store.ts
    - packages/test-utils/src/mocks/index.ts
    - packages/test-utils/src/index.test.ts
  modified:
    - tsconfig.json

key-decisions:
  - "Counter-based deterministic IDs over Faker for predictable test assertions"
  - "Factory functions with defaults and option overrides pattern"
  - "MockCredentialStore follows ResultAsync interface from real credential stores"
  - "Type guard pattern instead of non-null assertions in tests"

patterns-established:
  - "createTestX() factory functions with options object for overrides"
  - "resetXCounter() functions for test isolation in beforeEach"
  - "MockLogger with calls array, getCallsAt(), and hasLoggedAt() helpers"
  - "In-memory store mocks that match real service interfaces"

# Metrics
duration: 8min
completed: 2026-01-23
---

# Phase 20 Plan 02: Test Utilities Package Summary

**@aesir/test-utils package with deterministic factory functions and mock implementations for consistent testing infrastructure**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-23T21:30:00Z
- **Completed:** 2026-01-23T21:38:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Created @aesir/test-utils package with proper monorepo integration
- Factory functions for credentials, issues, and PRs with deterministic counter-based IDs
- MockLogger captures log calls with level filtering and pattern matching
- MockCredentialStore provides in-memory storage following ResultAsync patterns
- All exports available from package root via barrel exports

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test-utils package scaffolding** - `c3f562f` (chore)
2. **Task 2: Create factory functions for test data** - `b5e4523` (feat)
3. **Task 3: Create mock implementations** - `2bdbca9` (feat)
4. **Verification tests** - `a1302e6` (test)

## Files Created/Modified

- `packages/test-utils/package.json` - Package definition with @aesir/common and neverthrow dependencies
- `packages/test-utils/tsconfig.json` - TypeScript config extending tsconfig.base.json
- `packages/test-utils/vitest.config.ts` - Vitest project config for unit tests
- `packages/test-utils/src/index.ts` - Main barrel export for factories and mocks
- `packages/test-utils/src/factories/credentials.ts` - createTestCredential factory
- `packages/test-utils/src/factories/issues.ts` - createTestIssue and createTestPR factories
- `packages/test-utils/src/factories/index.ts` - Factory barrel export with resetAllCounters
- `packages/test-utils/src/mocks/logger.ts` - MockLogger with call capture and assertion helpers
- `packages/test-utils/src/mocks/credential-store.ts` - In-memory credential store mock
- `packages/test-utils/src/mocks/index.ts` - Mock barrel export
- `packages/test-utils/src/index.test.ts` - 11 verification tests for all exports
- `tsconfig.json` - Added test-utils to project references

## Decisions Made

- **Counter-based IDs:** Using incrementing counters (test_cred_0, test_cred_1) instead of Faker for predictable assertions
- **tsconfig.base.json extension:** Following pattern from other packages rather than extending root tsconfig.json
- **Type guards over non-null assertions:** Using `if (!stored) return` pattern instead of `stored!` for Biome compliance
- **biome-ignore for verbose console.log:** Intentional console output for debugging tests when verbose mode enabled

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript config inheritance**
- **Found during:** Task 1 (package scaffolding)
- **Issue:** tsconfig.json extended root tsconfig.json which doesn't have compilerOptions
- **Fix:** Changed to extend tsconfig.base.json like other packages
- **Files modified:** packages/test-utils/tsconfig.json
- **Verification:** `pnpm --filter @aesir/test-utils typecheck` passes
- **Committed in:** c3f562f

**2. [Rule 1 - Bug] exactOptionalPropertyTypes type error**
- **Found during:** Task 3 (mock implementations)
- **Issue:** `object | undefined` not assignable to `Record<string, unknown> | undefined`
- **Fix:** Extract context with explicit type assertion before conditional assignment
- **Files modified:** packages/test-utils/src/mocks/logger.ts
- **Verification:** Build and typecheck pass
- **Committed in:** 2bdbca9

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct compilation. No scope creep.

## Issues Encountered

- Biome import organization required auto-fixing on factories/index.ts exports
- noNonNullAssertion lint rule required refactoring test assertions to use type guards

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- @aesir/test-utils package ready for use by other packages
- Factory functions available for test data generation
- Mock implementations ready for unit testing services
- Integration tests (testcontainers) planned for later plans in Phase 20

---
*Phase: 20-testing-pyramid*
*Completed: 2026-01-23*
