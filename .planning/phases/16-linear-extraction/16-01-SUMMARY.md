---
phase: 16-linear-extraction
plan: 01
subsystem: integrations
tags: [linear, pnpm, workspace, drizzle, express, zod, neverthrow]

# Dependency graph
requires:
  - phase: 15-code-quality
    provides: Error handling patterns (AppError, ResultAsync), layer boundaries
  - phase: 11-monorepo-setup
    provides: pnpm workspace structure, TypeScript project references
provides:
  - "@aesir/integration-linear package scaffold with dependencies"
  - "Self-contained environment validation (linearEnvSchema)"
  - "LinearError class with HTTP status mapping"
affects:
  - 16-02-database-schema
  - 16-03-code-migration

# Tech tracking
tech-stack:
  added:
    - "@aesir/integration-linear package"
    - "express: ^4.21.0"
  patterns:
    - "Self-contained env validation per integration package"
    - "LinearError extends AppError with integration-specific codes"

key-files:
  created:
    - packages/integrations/linear/package.json
    - packages/integrations/linear/tsconfig.json
    - packages/integrations/linear/vitest.config.ts
    - packages/integrations/linear/drizzle.config.ts
    - packages/integrations/linear/src/types/config.ts
    - packages/integrations/linear/src/types/errors.ts
    - packages/integrations/linear/src/index.ts
  modified:
    - pnpm-workspace.yaml

key-decisions:
  - "Add packages/integrations/* pattern to pnpm-workspace.yaml for nested packages"
  - "Express framework for HTTP server (familiar patterns, pino-http compatibility)"
  - "Self-contained env validation with dotenv-flow in each integration"
  - "LinearError with INT_LINEAR_* code convention following Phase 15 pattern"

patterns-established:
  - "Integration packages at packages/integrations/{name}/"
  - "Dual config export: env (raw) and config (typed nested object)"
  - "HTTP status mapping based on error codes (401 webhook/token, 400 oauth, 500 api)"
  - "Drizzle config with schema namespace (linear.*) and custom migrations table"

# Metrics
duration: 3min
completed: 2026-01-21
---

# Phase 16 Plan 01: Linear Package Scaffolding Summary

**Independent @aesir/integration-linear package with pnpm workspace config, TypeScript project references, and self-contained env validation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-21T18:39:20Z
- **Completed:** 2026-01-21T18:42:19Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created @aesir/integration-linear package recognized by pnpm workspace
- Configured TypeScript with project reference to @aesir/common
- Implemented self-contained environment validation (linearEnvSchema)
- Defined LinearError class with HTTP status mapping
- Package builds and typechecks successfully

## Task Commits

Each task was committed atomically:

1. **Task 1: Create package scaffolding and workspace config** - `74b5346` (chore)
2. **Task 2: Create self-contained env validation and error types** - `da08499` (feat)

## Files Created/Modified

- `pnpm-workspace.yaml` - Added packages/integrations/* pattern
- `packages/integrations/linear/package.json` - Package manifest with dependencies
- `packages/integrations/linear/tsconfig.json` - TypeScript config with common reference
- `packages/integrations/linear/vitest.config.ts` - Test configuration
- `packages/integrations/linear/drizzle.config.ts` - Database migration config for linear schema
- `packages/integrations/linear/src/types/config.ts` - Environment validation schema
- `packages/integrations/linear/src/types/errors.ts` - LinearError class
- `packages/integrations/linear/src/index.ts` - Barrel export

## Decisions Made

**1. Express over Hono for HTTP framework**
- Rationale: Familiar patterns, pino-http middleware already exists in codebase, adequate performance for webhook handling
- Future consideration: Hono for new integrations once Linear pattern proven

**2. Self-contained env validation per integration**
- Rationale: Each integration validates its own env vars, enables independent deployment
- Pattern: dotenv-flow + zod schema at package level

**3. Linear-specific PostgreSQL schema namespace**
- Rationale: Full data isolation for Linear integration (linear.credentials, linear.webhook_deliveries)
- Configuration: drizzle.config.ts with schemaFilter: ["linear"]

**4. HTTP status mapping based on error codes**
- Rationale: Clear semantic mapping for client error handling
- Implementation: 401 for webhook/token errors, 400 for oauth validation, 500 for API errors

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. Biome lint errors after initial commit**
- Issue: noUselessSwitchCase warning for redundant INT_LINEAR_API case before default
- Resolution: Removed redundant case, applied safe formatting fix
- Impact: None - fixed before final commit

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for 16-02 (Database Schema):**
- Package structure in place
- drizzle.config.ts configured for linear schema
- Dependencies installed (drizzle-orm, pg)

**Ready for 16-03 (Code Migration):**
- LinearError class available for imports
- Config types ready for use
- Barrel exports established in src/index.ts

**No blockers identified.**

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
