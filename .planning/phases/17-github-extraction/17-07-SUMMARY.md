---
phase: 17-github-extraction
plan: 07
subsystem: database
tags: [postgresql, drizzle, migration, credentials, encryption]

# Dependency graph
requires:
  - phase: 17-02
    provides: "GitHub credential store with encryption"
provides:
  - "SQL migration creating github.* schema with credentials and webhook_deliveries tables"
  - "Credential migration script for GITHUB_TOKEN env var"
  - "Idempotent migration setup for GitHub package"
affects: [17-08, 17-09, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL migration with CREATE SCHEMA IF NOT EXISTS for idempotency"
    - "Direct pg Pool in migration scripts to avoid config validation"
    - "Migration script migrates env var to database with encryption"

key-files:
  created:
    - "packages/integrations/github/src/db/migrations/0000_create_github_schema.sql"
    - "packages/integrations/github/scripts/migrate-credentials.ts"
  modified: []

key-decisions:
  - "Migration script uses GITHUB_TOKEN env var directly (not migrating from integrations.credentials like Linear)"
  - "Updated_at trigger function in github schema for automatic timestamp updates"
  - "Drizzle migration tracking table in github schema"

patterns-established:
  - "Migration SQL pattern: schema creation, tables, triggers, indexes all in one file"
  - "Migration script pattern: check schema exists, run SQL if needed, migrate credentials"
  - "Script invocation via pnpm --filter for package-specific operations"

# Metrics
duration: 3min
completed: 2026-01-21
---

# Phase 17 Plan 07: Database Migration and Credential Migration Summary

**SQL migration creating github.* schema with credentials/webhook_deliveries tables and script to migrate GITHUB_TOKEN to encrypted database storage**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-21T20:51:02Z
- **Completed:** 2026-01-21T20:53:32Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Idempotent SQL migration creating github schema and tables
- Credential migration script reads GITHUB_TOKEN env var and stores encrypted in database
- Migration safe to run multiple times without errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database migration SQL** - `1577c6d` (feat)
2. **Task 2: Create credential migration script and update package.json** - `eb72225` (feat)

## Files Created/Modified
- `packages/integrations/github/src/db/migrations/0000_create_github_schema.sql` - SQL migration for github.* schema
- `packages/integrations/github/scripts/migrate-credentials.ts` - Migration script for GITHUB_TOKEN env var

## Decisions Made

**Migration approach differs from Linear:**
- Linear migration script reads from integrations.credentials table (migrating existing data)
- GitHub migration script reads from GITHUB_TOKEN env var (no prior database storage)
- Both use same pattern for schema creation and idempotency checks

**Schema design:**
- github.credentials table has owner field (org or user) - unique identifier
- installation_id field for future GitHub Apps support (nullable)
- github.webhook_deliveries table for idempotency tracking
- updated_at trigger for automatic timestamp maintenance

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Biome formatting violations in initial commit:**
- Issue: Long lines needed wrapping, unused variable needed underscore prefix
- Fix: Applied Biome formatting suggestions and prefixed unused integrationCredentials with underscore
- Note: integrationCredentials schema defined for future reference but not used in current migration

## Next Phase Readiness

Ready for:
- 17-08: Webhook HTTP routes can use github.webhook_deliveries table
- 17-09: OAuth flow can use credential store with database-backed storage
- Deployment: Migration script can be run as part of container startup

Migration command: `pnpm --filter @aesir/integration-github migrate`

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
