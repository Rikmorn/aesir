---
phase: 18-slack-extraction
plan: 08
subsystem: database
tags: [postgresql, migration, drizzle, slack, credentials, encryption]

# Dependency graph
requires:
  - phase: 18-02
    provides: Slack credential store for storeInstallation
  - phase: 18-07
    provides: HTTP API layer (depends_on in plan)
provides:
  - Database migration SQL for slack.* schema
  - Credential migration script for env to database transition
affects: [18-09, 18-10, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Idempotent SQL migration with IF NOT EXISTS
    - Dynamic import for migration scripts to avoid circular dependencies

key-files:
  created:
    - packages/integrations/slack/src/db/migrations/0000_create_slack_schema.sql
    - packages/integrations/slack/scripts/migrate-credentials.ts
  modified: []

key-decisions:
  - "Composite unique constraint on (team_id, enterprise_id) for workspace identification"
  - "Event deduplication via unique event_id constraint"
  - "Default team_id 'default' for single-tenant deployments"
  - "Default scopes from 18-06 decision used in migration"

patterns-established:
  - "Migration script pattern: check schema, run SQL, migrate credentials"
  - "Drizzle migration tracking table for each schema namespace"

# Metrics
duration: 2min
completed: 2026-01-23
---

# Phase 18 Plan 08: Database Migration Summary

**Slack schema migration SQL and credential migration script for transitioning to database-backed storage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-23T12:27:42Z
- **Completed:** 2026-01-23T12:29:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created idempotent SQL migration for slack.* schema namespace
- Built installations table matching Bolt's Installation model
- Built event_deliveries table with event_id unique constraint for deduplication
- Created credential migration script to move SLACK_BOT_TOKEN to database

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database migration SQL** - `d5a677d` (feat)
2. **Task 2: Create credential migration script** - `a1f3f3b` (feat)

## Files Created/Modified

- `packages/integrations/slack/src/db/migrations/0000_create_slack_schema.sql` - Idempotent schema creation
- `packages/integrations/slack/scripts/migrate-credentials.ts` - Credential migration from env to database

## Decisions Made

- [18-08]: Composite unique constraint on (team_id, enterprise_id) for workspace identification
- [18-08]: Event deduplication via unique event_id constraint (not delivery_id like Linear/GitHub)
- [18-08]: Default team_id "default" for single-tenant deployments (matches GitHub DEFAULT_OWNER pattern)
- [18-08]: Migration script uses default scopes from 18-06 decision

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Database migration ready for deployment via `pnpm --filter @aesir/integration-slack migrate`
- Credential migration script can transition existing SLACK_BOT_TOKEN to database storage
- Ready for Dockerfile and deployment (18-09)

---
*Phase: 18-slack-extraction*
*Completed: 2026-01-23*
