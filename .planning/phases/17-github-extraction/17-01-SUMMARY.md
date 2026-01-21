---
phase: 17-github-extraction
plan: 01
subsystem: integrations
tags: [github, octokit, pnpm, workspace, drizzle, express]

# Dependency graph
requires:
  - phase: 16-linear-extraction
    provides: Integration extraction pattern (independent package with HTTP service)
provides:
  - @aesir/integration-github package scaffolding
  - Self-contained environment validation (GITHUB_* vars)
  - GitHubError class with HTTP status mapping
affects: [17-02, 17-03, 17-04, 17-05, 17-06, 17-07, 17-08, 17-09, 17-10, 17-11]

# Tech tracking
tech-stack:
  added: [@aesir/integration-github, @octokit/rest, @octokit/webhooks-methods]
  patterns: [github.* schema namespace, PORT 3002 for GitHub service]

key-files:
  created:
    - packages/integrations/github/package.json
    - packages/integrations/github/tsconfig.json
    - packages/integrations/github/vitest.config.ts
    - packages/integrations/github/drizzle.config.ts
    - packages/integrations/github/src/types/config.ts
    - packages/integrations/github/src/types/errors.ts
    - packages/integrations/github/src/types/index.ts
    - packages/integrations/github/src/index.ts
  modified: [pnpm-lock.yaml]

key-decisions:
  - "PORT 3002 for GitHub service (Linear uses 3001)"
  - "github.* schema namespace for database isolation"
  - "@octokit/webhooks-methods for signature verification"
  - "Follow Linear pattern exactly for config and errors"

patterns-established:
  - "Integration package scaffolding pattern: package.json, tsconfig, vitest, drizzle configs"
  - "Self-contained env validation at package level"
  - "GitHubError extends AppError with integration-specific error codes"
  - "HTTP status mapping based on error codes"

# Metrics
duration: 2min
completed: 2026-01-21
---

# Phase 17 Plan 01: Package Scaffolding Summary

**@aesir/integration-github package with self-contained environment validation, error types, and project references to common**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-21T20:35:08Z
- **Completed:** 2026-01-21T20:37:03Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Created @aesir/integration-github workspace package with dependencies (@octokit/rest, drizzle-orm, express)
- Self-contained environment validation with githubEnvSchema (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET)
- GitHubError class with HTTP status mapping (401 webhook/token, 400 oauth, 500 API)
- TypeScript configuration with project references to @aesir/common

## Task Commits

Each task was committed atomically:

1. **Task 1: Create package scaffolding and config files** - `7ca47f3` (chore)
2. **Task 2: Create self-contained env validation and error types** - `19f0d87` (feat)

## Files Created/Modified

### Created
- `packages/integrations/github/package.json` - Package manifest with dependencies
- `packages/integrations/github/tsconfig.json` - TypeScript config with common reference
- `packages/integrations/github/vitest.config.ts` - Vitest configuration for integration-github
- `packages/integrations/github/drizzle.config.ts` - Drizzle config for github.* schema
- `packages/integrations/github/src/types/config.ts` - Self-contained env validation
- `packages/integrations/github/src/types/errors.ts` - GitHubError class
- `packages/integrations/github/src/types/index.ts` - Types barrel export
- `packages/integrations/github/src/index.ts` - Package main export (minimal, types only)

### Modified
- `pnpm-lock.yaml` - Added dependencies for new package

## Decisions Made

1. **PORT 3002 for GitHub service** - Different from Linear's 3001 to avoid conflicts
2. **github.* schema namespace** - Full database isolation following Linear pattern
3. **@octokit/webhooks-methods** - For signature verification (separate from @octokit/rest)
4. **Follow Linear pattern exactly** - Config structure, error class, HTTP status mapping

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. Biome formatting check on first commit**
- **Issue:** GITHUB_WEBHOOK_SECRET split across multiple lines, Biome wanted single line
- **Resolution:** Consolidated to single line `.min(1, "GITHUB_WEBHOOK_SECRET is required")`
- **Impact:** Pre-commit hook caught issue, fixed immediately

## User Setup Required

None - no external service configuration required. Environment variables documented in types/config.ts.

## Next Phase Readiness

**Ready for 17-02 (Database Schema)**:
- Package structure established
- Drizzle configuration in place with github.* schema filter
- Database credentials schema can reference env config

**No blockers or concerns**

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
