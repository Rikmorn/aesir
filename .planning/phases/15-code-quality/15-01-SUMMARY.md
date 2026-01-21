---
phase: 15-code-quality
plan: 01
subsystem: errors
tags: [neverthrow, knip, error-handling, zod]

# Dependency graph
requires:
  - phase: 11-monorepo-setup
    provides: @aesir/common package structure
provides:
  - AppError base class with code, cause, metadata, httpStatus
  - ValidationError for Zod validation failures
  - toAppError utility for wrapping unknown errors
  - neverthrow library available for Result types
  - knip tool for dead code detection
affects: [15-02, 15-03, 15-04, 15-05, integrations, agents, platform]

# Tech tracking
tech-stack:
  added: [neverthrow 8.2.0, knip 5.82.1]
  patterns: [AppError hierarchy, error codes LAYER_COMPONENT_ERROR]

key-files:
  created:
    - packages/common/src/errors/app-error.ts
    - packages/common/src/errors/to-app-error.ts
    - packages/common/src/errors/validation-error.ts
    - packages/common/src/errors/index.ts
  modified:
    - packages/common/src/index.ts
    - packages/common/package.json
    - package.json

key-decisions:
  - "Handle exactOptionalPropertyTypes with conditional property assignment"
  - "Error code convention: LAYER_COMPONENT_ERROR (INT_, PLT_, AGT_)"
  - "ValidationError httpStatus always returns 400 (Bad Request)"
  - "toAppError preserves existing AppError instances (no double-wrapping)"

patterns-established:
  - "AppError: abstract base with code, cause, metadata, recovery, httpStatus, toJSON"
  - "UnknownError: concrete wrapper for non-AppError errors"
  - "ValidationError: extends AppError with validationErrors and 400 httpStatus"

# Metrics
duration: 3min
completed: 2026-01-21
---

# Phase 15 Plan 01: Error Foundation Summary

**AppError hierarchy with ValidationError and toAppError utility in @aesir/common, neverthrow and knip installed**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-21T12:57:14Z
- **Completed:** 2026-01-21T13:00:30Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- AppError abstract base class with code, cause, metadata, recovery, httpStatus
- ValidationError for Zod validation failures with FlattenedErrors type
- toAppError utility preserving existing AppError instances
- neverthrow 8.2.0 installed for Result types in future plans
- knip 5.82.1 installed for dead code detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Install neverthrow and knip dependencies** - `5ac6d25` (chore)
2. **Task 2: Create AppError base class and error utilities** - `fa43ef1` (feat)
3. **Task 3: Create ValidationError and wire to common exports** - `09847f9` (feat)

## Files Created/Modified

- `packages/common/src/errors/app-error.ts` - Abstract AppError base class
- `packages/common/src/errors/to-app-error.ts` - UnknownError class and toAppError utility
- `packages/common/src/errors/validation-error.ts` - ValidationError for Zod failures
- `packages/common/src/errors/index.ts` - Barrel exports for error module
- `packages/common/src/index.ts` - Added errors export
- `packages/common/package.json` - Added neverthrow dependency
- `package.json` - Added knip devDependency
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made

- **exactOptionalPropertyTypes handling:** Use conditional property assignment pattern (if defined, assign) instead of always assigning undefined values
- **Error code convention:** LAYER_COMPONENT_ERROR format (INT_LINEAR_RATE_LIMIT, PLT_DB_CONNECTION, AGT_EXECUTION_FAILED)
- **ValidationError httpStatus:** Always returns 400 (Bad Request) - appropriate for input validation failures
- **toAppError preservation:** Preserves existing AppError instances to avoid double-wrapping and cause chain loss

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed exactOptionalPropertyTypes compilation errors**
- **Found during:** Task 2 (AppError base class creation)
- **Issue:** TypeScript with exactOptionalPropertyTypes enabled rejected assigning `options?.cause` to `this.cause` when cause could be undefined
- **Fix:** Use conditional assignment pattern: `if (options?.cause !== undefined) { this.cause = options.cause; }`
- **Files modified:** packages/common/src/errors/app-error.ts, packages/common/src/errors/to-app-error.ts
- **Verification:** `pnpm --filter @aesir/common build` compiles without errors
- **Committed in:** fa43ef1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix required for TypeScript compilation. No scope creep.

## Issues Encountered

- Biome import ordering check failed on initial Task 3 commit - fixed by reordering type exports before value exports

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Error hierarchy established and ready for domain-specific subclasses
- neverthrow available for Result type wrappers in 15-02
- knip available for dead code detection in 15-04
- All error types exported from @aesir/common

---
*Phase: 15-code-quality*
*Completed: 2026-01-21*
