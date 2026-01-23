---
phase: 20-testing-pyramid
plan: 01
subsystem: testing
tags: [vitest, coverage, v8, monorepo]

# Dependency graph
requires:
  - phase: 11-monorepo-setup
    provides: Vitest projects mode for workspace testing
provides:
  - Workspace-level coverage configuration with V8 provider
  - Per-package coverage thresholds (70% core, 50% integrations/agents)
  - Coverage exclusion patterns for tests, migrations, legacy code
  - test:coverage and test:coverage:open scripts
affects: [21-ci-cd, testing, quality]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coverage thresholds tiered by package criticality"
    - "Explicit project paths for vitest workspace"

key-files:
  created: []
  modified:
    - vitest.config.ts
    - package.json
    - packages/test-utils/package.json

key-decisions:
  - "V8 coverage provider over Istanbul (native, faster)"
  - "Coverage disabled by default, enabled via --coverage flag"
  - "Explicit project paths to avoid tsbuildinfo glob match"
  - "70% thresholds for core packages, 50% for integrations/agents"

patterns-established:
  - "Coverage thresholds: core=70%, integrations/agents=50%"
  - "Coverage exclusions: tests, migrations, legacy, entry points"

# Metrics
duration: 8min
completed: 2026-01-23
---

# Phase 20 Plan 01: Coverage Configuration Summary

**Vitest workspace coverage with V8 provider, per-package thresholds, and comprehensive exclusions**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-23T21:33:00Z
- **Completed:** 2026-01-23T21:41:00Z
- **Tasks:** 3 (1 no-op - already done)
- **Files modified:** 3

## Accomplishments
- Configured V8 coverage with text, html, and lcov reporters
- Set per-package thresholds (70% core, 50% integrations)
- Comprehensive exclusions for non-source files
- test:coverage:open script for quick HTML report viewing

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure workspace-level coverage** - `7c89cda` (feat)
2. **Task 2: Update package.json scripts** - `e83d422` (feat)
3. **Task 3: Add coverage to gitignore** - No commit (already present)

## Files Created/Modified
- `vitest.config.ts` - Added coverage configuration with thresholds and exclusions
- `package.json` - Added test:coverage:open script
- `packages/test-utils/package.json` - Added @types/node (blocking fix)

## Decisions Made
- **V8 over Istanbul:** Native coverage is faster and requires no separate instrumentation
- **Disabled by default:** Running tests without coverage is faster for development; --coverage flag enables for CI
- **Explicit project paths:** Changed from glob `packages/integrations/*` to explicit paths to avoid matching `.tsbuildinfo` files
- **Tiered thresholds:** Core packages (common, platform, observability) at 70%, integration packages at 50%

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/node to test-utils package**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** test-utils package was missing @types/node, causing TypeScript compilation failure
- **Fix:** Added @types/node to test-utils devDependencies
- **Files modified:** packages/test-utils/package.json
- **Verification:** pnpm build succeeds
- **Committed in:** 7c89cda (Task 1 commit)

**2. [Rule 1 - Bug] Fixed vitest projects glob pattern**
- **Found during:** Task 2 verification
- **Issue:** `packages/integrations/*` glob matched tsconfig.tsbuildinfo file, causing esbuild loader error
- **Fix:** Changed to explicit project paths array
- **Files modified:** vitest.config.ts
- **Verification:** pnpm test:coverage runs without startup errors
- **Committed in:** e83d422 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for coverage to function. No scope creep.

## Issues Encountered
- Pre-existing test failures in agents, common, platform packages (documented in STATE.md pending todos) - these are outside scope of this plan

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Coverage infrastructure ready for CI/CD integration in Phase 21
- Pre-existing test failures should be fixed before enforcing thresholds in CI
- HTML report generation verified at coverage/index.html

---
*Phase: 20-testing-pyramid*
*Completed: 2026-01-23*
