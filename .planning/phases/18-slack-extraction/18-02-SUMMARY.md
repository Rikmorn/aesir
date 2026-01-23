---
phase: 18-slack-extraction
plan: 02
subsystem: database
tags: [drizzle, postgres, slack, encryption, neverthrow]

# Dependency graph
requires:
  - phase: 18-01
    provides: Package scaffolding, env validation, SlackError class
  - phase: 16-02
    provides: Database schema pattern (linear.*)
  - phase: 17-02
    provides: Credential store pattern (github.*)
provides:
  - slack.* PostgreSQL schema namespace
  - SlackCredentialStore for Bolt's installationStore interface
  - SlackEventDeliveryStore for event deduplication
  - AES-256-CBC token encryption utilities
affects: [18-03, 18-04, 18-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Bolt installationStore-compatible credential storage
    - Event deduplication via event_id for idempotent processing

key-files:
  created:
    - packages/integrations/slack/src/db/schema.ts
    - packages/integrations/slack/src/db/schema.drizzle.ts
    - packages/integrations/slack/src/db/credential-store.ts
    - packages/integrations/slack/src/db/event-delivery-store.ts
    - packages/integrations/slack/src/db/encryption.ts
    - packages/integrations/slack/src/db/client.ts
    - packages/integrations/slack/src/db/index.ts
  modified: []

key-decisions:
  - "Composite unique constraint on team_id + enterprise_id (soft-delete handling at application layer)"
  - "Event deduplication uses ON CONFLICT DO NOTHING for atomic operations"
  - "StoreInstallationInput matches Bolt's Installation model structure"

patterns-established:
  - "SlackCredentialStore interface maps to Bolt's installationStore"
  - "All service boundary methods return ResultAsync<T, SlackError>"

# Metrics
duration: 6min
completed: 2026-01-23
---

# Phase 18-02: Database Layer Summary

**Slack database schema with installations table for Bolt's installationStore and event_deliveries for deduplication**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-23T11:56:15Z
- **Completed:** 2026-01-23T12:02:11Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Created slack.* PostgreSQL schema namespace with isolated tables
- Implemented SlackCredentialStore compatible with Bolt's installationStore interface
- Added SlackEventDeliveryStore for event_id-based deduplication
- Token encryption with AES-256-CBC (iv:ciphertext format)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database schema and encryption utilities** - `4779664` (feat)
2. **Task 2: Create credential store and event delivery store** - `a48dace` (feat)

## Files Created/Modified

- `packages/integrations/slack/src/db/schema.ts` - Drizzle schema with slack.installations and slack.event_deliveries tables
- `packages/integrations/slack/src/db/schema.drizzle.ts` - Migration-only schema with inline nanoid (CJS bundler compatibility)
- `packages/integrations/slack/src/db/credential-store.ts` - Bolt-compatible installationStore with storeInstallation/fetchInstallation/deleteInstallation
- `packages/integrations/slack/src/db/event-delivery-store.ts` - Event deduplication via event_id with ON CONFLICT DO NOTHING
- `packages/integrations/slack/src/db/encryption.ts` - AES-256-CBC token encryption utilities
- `packages/integrations/slack/src/db/client.ts` - PostgreSQL pool and Drizzle client
- `packages/integrations/slack/src/db/index.ts` - Barrel export for database layer

## Decisions Made

- **Composite unique constraint without partial index:** Used simple unique constraint on (team_id, enterprise_id) instead of partial index with WHERE deleted_at IS NULL. Soft-delete handling done at application layer before inserting new installation. Follows Linear/GitHub pattern.
- **Event deduplication with ON CONFLICT DO NOTHING:** Atomic deduplication that returns gracefully for duplicate events. No error thrown for expected duplicates.
- **StoreInstallationInput matches Bolt's Installation:** botToken, userToken, botId, botUserId, botScopes map to Bolt's expected fields for seamless integration.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript error with .where() on uniqueIndex:** Drizzle's uniqueIndex().where() expects SQL, not a column reference. Fixed by using simple unique() constraint instead of partial index. Application layer handles soft-delete before insert.
- **ErrorMetadata type mismatch:** Query interfaces not assignable to ErrorMetadata due to missing index signature. Fixed by spreading query objects into metadata: `{ ...query }`.

## User Setup Required

None - no external service configuration required. Database migration will be created in a later plan.

## Next Phase Readiness

- Database layer complete with schema and stores
- Ready for 18-03: Bolt adapter implementation
- Credential store ready to back Bolt's installationStore
- Event delivery store ready for event handler integration

---
*Phase: 18-slack-extraction*
*Completed: 2026-01-23*
