---
phase: 16-linear-extraction
plan: 07
subsystem: database
tags: [postgresql, migration, drizzle, schema-namespace, data-migration]

# Dependency graph
requires:
  - phase: 16-02
    provides: Linear credential store with linear.* schema tables defined in Drizzle

provides:
  - SQL migration for creating linear.* PostgreSQL schema namespace
  - Idempotent script to migrate Linear credentials from integrations.credentials
  - Migration infrastructure for Linear's isolated database schema

affects: [16-09, 16-10, containerization, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL migrations with IF NOT EXISTS for idempotency"
    - "Direct DB connection in migration scripts (bypasses config validation)"
    - "Inline schema definitions in scripts to avoid import dependencies"

key-files:
  created:
    - packages/integrations/linear/src/db/migrations/0000_create_linear_schema.sql
    - scripts/migrate-linear-credentials.ts
  modified: []

key-decisions:
  - "Migration SQL uses IF NOT EXISTS for idempotent schema creation"
  - "Migration script checks for schema existence before running SQL"
  - "Credential migration filters by provider='linear' to isolate Linear data"
  - "Script reuses existing IDs when migrating credentials"

patterns-established:
  - "Updated_at trigger function created per schema namespace"
  - "Drizzle migration tracking table per schema (__drizzle_linear_migrations)"
  - "Migration scripts use direct pg Pool to avoid full environment validation"

# Metrics
duration: 2min
completed: 2026-01-21
---

# Phase 16 Plan 07: Database Migration Summary

**Linear schema migration and credential data migration from integrations.credentials to linear.credentials**

## Performance

- **Duration:** 2 minutes
- **Started:** 2026-01-21T19:05:51Z
- **Completed:** 2026-01-21T19:07:53Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- SQL migration creates linear.* schema with credentials and webhook_deliveries tables
- Idempotent migration script migrates existing Linear credentials from integrations.credentials
- Migration infrastructure supports Linear's isolated database namespace for containerization

## Task Commits

Each task was committed atomically:

1. **Task 1: Create linear schema migration** - `51319b3` (feat)
   - CREATE SCHEMA IF NOT EXISTS linear
   - Create credentials table (workspace_id unique, no provider field)
   - Create webhook_deliveries table
   - Create updated_at trigger function and trigger
   - Create __drizzle_linear_migrations tracking table

2. **Task 2: Create credential migration script** - `4c3fb1e` (feat)
   - Migrates credentials from integrations.credentials WHERE provider='linear'
   - Checks if linear schema exists, runs migration if not
   - Idempotent: skips credentials already in linear.credentials
   - Logs clear migration summary (total found, migrated, skipped)

## Files Created/Modified

**Created:**
- `packages/integrations/linear/src/db/migrations/0000_create_linear_schema.sql` - Idempotent SQL migration for linear.* schema namespace
- `scripts/migrate-linear-credentials.ts` - Data migration script from integrations.credentials to linear.credentials

## Decisions Made

**1. Migration SQL idempotency**
- Used IF NOT EXISTS for CREATE SCHEMA and CREATE TABLE
- Enables safe re-running of migration without errors
- Rationale: Critical for containerized deployments where migration may run multiple times

**2. Filter by provider='linear' in migration script**
- Explicitly filters source query by provider='linear' AND deleted_at IS NULL
- Addresses Pitfall 5 from RESEARCH.md (must filter credentials by provider)
- Rationale: Ensures only Linear credentials are migrated, not other integrations

**3. Reuse existing credential IDs**
- Migration script uses existing id field instead of generating new IDs
- Maintains referential integrity if other systems reference credential IDs
- Rationale: Safer migration path, preserves existing data relationships

**4. Inline schema definitions in migration script**
- Defines integrationsSchema and linearSchema tables inline
- Avoids importing from schema files which import @aesir/common
- Rationale: Prevents triggering full environment validation during migration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

Migration script requires database access and can be run with:
```bash
npx tsx scripts/migrate-linear-credentials.ts
```

Environment variables needed:
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (database connection)

## Next Phase Readiness

**Ready for:**
- 16-09: Container deployment with isolated Linear database schema
- 16-10: Integration tests against linear.* schema
- Any phase requiring Linear credential storage in isolated namespace

**No blockers or concerns.**

The migration infrastructure enables Linear to own its database schema completely, supporting the extraction architecture where Linear operates as an independent containerized service.

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
