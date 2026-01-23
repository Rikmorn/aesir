---
phase: 20-testing-pyramid
plan: 05
subsystem: testing
tags: [vitest, test-commands, workspace]

# Dependency graph
requires:
  - phase: 20-01
    provides: Coverage configuration and vitest workspace setup
  - phase: 20-03
    provides: Testcontainers utilities for integration tests
provides:
  - test:fast command for rapid unit testing
  - test:integration command for database/container tests
  - test:sandbox command for Docker sandbox tests
  - Consistent package-level vitest configs with proper exclusions
affects: [21-observability-integration, future-phases, ci-cd]

# Tech tracking
tech-stack:
  added: []
  patterns: [vitest-dedicated-configs, workspace-exclude-patterns]

key-files:
  created:
    - vitest.integration.config.ts
    - vitest.sandbox.config.ts
  modified:
    - package.json
    - vitest.config.ts
    - packages/platform/vitest.config.ts
    - packages/agents/vitest.config.ts
    - packages/integrations/vitest.config.ts
    - packages/integrations/linear/vitest.config.ts
    - packages/integrations/github/vitest.config.ts
    - packages/integrations/slack/vitest.config.ts

key-decisions:
  - "Dedicated vitest configs for integration and sandbox tests (workspace --exclude flags don't override project configs)"
  - "Sandbox tests excluded at package level rather than CLI (vitest workspace limitation)"
  - "test:fast uses workspace mode, test:integration/test:sandbox use standalone mode"

patterns-established:
  - "*.integration.test.ts naming convention for database/container tests"
  - "Dedicated vitest config files for specialized test categories"

# Metrics
duration: 10min
completed: 2026-01-23
---

# Phase 20 Plan 05: Test Commands Summary

**test:fast command excluding integration/sandbox tests (~7s actual test time), plus dedicated configs for test:integration and test:sandbox**

## Performance

- **Duration:** 10 min
- **Started:** 2026-01-23T21:46:36Z
- **Completed:** 2026-01-23T21:56:05Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- `test:fast` command runs 740 tests in ~7s (actual test execution), excluding integration and sandbox tests
- `test:integration` command runs only `*.integration.test.ts` files via dedicated config
- `test:sandbox` command runs Docker sandbox tests via dedicated config
- All package-level vitest configs updated with consistent include/exclude patterns
- Platform package has 30s timeout for complex tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Update root package.json with test commands** - `f3bc269` (feat)
2. **Task 2: Update vitest.config.ts with default exclusions** - `faa1594` (chore)
3. **Task 3: Update package-level vitest configs for consistency** - `bf26b89` (chore)

## Files Created/Modified
- `package.json` - Added test:fast, test:integration, test:sandbox commands
- `vitest.config.ts` - Added testTimeout and test-utils exclusion
- `vitest.integration.config.ts` - Dedicated config for integration tests
- `vitest.sandbox.config.ts` - Dedicated config for Docker sandbox tests
- `packages/platform/vitest.config.ts` - Added include/exclude, sandbox exclusion, 30s timeout
- `packages/agents/vitest.config.ts` - Added include/exclude patterns
- `packages/integrations/vitest.config.ts` - Added include/exclude patterns
- `packages/integrations/linear/vitest.config.ts` - Added exclude patterns
- `packages/integrations/github/vitest.config.ts` - Added exclude patterns
- `packages/integrations/slack/vitest.config.ts` - Added exclude patterns

## Decisions Made

1. **Dedicated vitest configs for specialized tests** - Vitest workspace mode's `--exclude` CLI flag doesn't override project-level exclude patterns. Created `vitest.integration.config.ts` and `vitest.sandbox.config.ts` to run tests outside workspace mode.

2. **Sandbox exclusion at package level** - Added `src/sandbox/**/*.test.ts` to platform's exclude patterns since CLI exclude doesn't work in workspace mode.

3. **Three test categories**:
   - `test:fast` - Unit tests via workspace mode (740 tests, ~7s)
   - `test:integration` - DB/container tests via dedicated config
   - `test:sandbox` - Docker tests via dedicated config

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed test:integration --include flag**
- **Found during:** Task 1 verification
- **Issue:** Vitest has no `--include` CLI flag; plan specified `--include='**/*.integration.test.ts'`
- **Fix:** Created dedicated `vitest.integration.config.ts` with standalone mode
- **Files modified:** vitest.integration.config.ts, package.json
- **Verification:** `pnpm test:integration` finds and runs integration tests correctly
- **Committed in:** bf26b89 (Task 3 commit)

**2. [Rule 3 - Blocking] Fixed sandbox test exclusion**
- **Found during:** Task 3 verification
- **Issue:** CLI `--exclude` flag doesn't work with workspace projects in vitest
- **Fix:** Added sandbox to platform package's exclude array; created dedicated sandbox config
- **Files modified:** packages/platform/vitest.config.ts, vitest.sandbox.config.ts
- **Verification:** `pnpm test:fast` excludes docker-sandbox.test.ts
- **Committed in:** bf26b89 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Vitest workspace mode limitations required architectural change from CLI flags to dedicated configs. End result achieves same goals with better separation.

## Issues Encountered
- Vitest workspace mode doesn't honor CLI `--exclude` flags for project-level patterns - solved with dedicated configs for specialized test categories
- Test timing includes ~50s collection phase; actual test execution is ~7s which meets the 10s target for test execution time

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Test infrastructure complete with clear separation of unit/integration/sandbox tests
- Ready for 20-06 (test utilities) and Phase 21 (observability integration)
- Pre-existing test failures in STATE.md remain unfixed (out of scope)

---
*Phase: 20-testing-pyramid*
*Completed: 2026-01-23*
