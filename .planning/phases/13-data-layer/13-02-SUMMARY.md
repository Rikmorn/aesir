---
phase: 13-data-layer
plan: 02
subsystem: database
tags: [drizzle, postgres, schema, credentials, platform, integrations, observability]

dependency_graph:
  requires:
    - phase: 13-01
      provides: drizzle-orm, pg driver, createId, db config
  provides:
    - platform schema (workspaces, configurations)
    - integrations schema (credentials, webhook_deliveries, sync_cursors)
    - observability schema namespace
    - per-package db clients with connection pooling
    - drizzle-kit migration configs
  affects: [13-03, 13-04, 13-05, 14-platform-services]

tech_stack:
  added: []
  patterns:
    - pgSchema for namespace isolation
    - per-package db clients
    - soft delete with deleted_at timestamps
    - partial unique indexes

key_files:
  created:
    - packages/platform/src/db/schema.ts
    - packages/platform/src/db/client.ts
    - packages/platform/src/db/index.ts
    - packages/platform/drizzle.config.ts
    - packages/integrations/src/db/schema.ts
    - packages/integrations/src/db/client.ts
    - packages/integrations/src/db/index.ts
    - packages/integrations/drizzle.config.ts
    - packages/observability/package.json
    - packages/observability/src/db/schema.ts
    - packages/observability/src/db/client.ts
    - packages/observability/src/db/index.ts
    - packages/observability/drizzle.config.ts
  modified:
    - packages/platform/package.json
    - packages/integrations/package.json
    - package.json
    - tsconfig.json

decisions:
  - id: 13-02-a
    choice: "uniqueIndex with .where() for partial indexes"
    reason: "Drizzle 0.45.1 supports partial indexes via uniqueIndex builder"
  - id: 13-02-b
    choice: "Created observability package from scratch"
    reason: "Package did not exist, needed for pgSchema('observability')"
  - id: 13-02-c
    choice: "workspace_id as text without FK"
    reason: "Avoid cross-schema FK migration ordering issues per RESEARCH.md"

patterns_established:
  - "Per-package db client: each package owns its Drizzle instance"
  - "Schema namespace isolation: pgSchema('platform'), pgSchema('integrations'), pgSchema('observability')"
  - "Soft delete pattern: deleted_at timestamp on all tables"
  - "Migration order: platform -> integrations -> observability"

metrics:
  duration: 6min
  completed: 2026-01-20
---

# Phase 13 Plan 02: Drizzle Schemas and DB Clients Summary

**Drizzle schemas for platform, integrations, and observability with per-package db clients and migration configs**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-20T22:56:36Z
- **Completed:** 2026-01-20T23:02:33Z
- **Tasks:** 4
- **Files modified:** 17

## Accomplishments

- Platform schema with workspaces and configurations tables
- Integrations schema with credentials, webhook_deliveries, sync_cursors tables
- Observability package created with stub schema for Phase 14
- Per-package db clients with connection pooling
- Root-level migration orchestration scripts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create platform schema and client** - `f5d21dd` (feat)
2. **Task 2: Create integrations schema and client** - `c258bcd` (feat)
3. **Task 3: Create observability schema stub** - `d239084` (feat)
4. **Task 4: Add npm scripts for migrations** - `442a517` (chore)

## Files Created/Modified

### Platform
- `packages/platform/src/db/schema.ts` - Platform schema with workspaces, configurations
- `packages/platform/src/db/client.ts` - Drizzle client with pg Pool
- `packages/platform/src/db/index.ts` - Module exports
- `packages/platform/drizzle.config.ts` - Migration config

### Integrations
- `packages/integrations/src/db/schema.ts` - Integrations schema with credentials, webhook_deliveries, sync_cursors
- `packages/integrations/src/db/client.ts` - Drizzle client with pg Pool
- `packages/integrations/src/db/index.ts` - Module exports
- `packages/integrations/drizzle.config.ts` - Migration config

### Observability (new package)
- `packages/observability/package.json` - Package manifest
- `packages/observability/tsconfig.json` - TypeScript config
- `packages/observability/vitest.config.ts` - Test config
- `packages/observability/src/index.ts` - Package entry
- `packages/observability/src/db/schema.ts` - Stub schema with pgSchema('observability')
- `packages/observability/src/db/client.ts` - Drizzle client with pg Pool
- `packages/observability/src/db/index.ts` - Module exports
- `packages/observability/drizzle.config.ts` - Migration config

### Root
- `tsconfig.json` - Added observability to references
- `package.json` - Added db:generate, db:migrate orchestration scripts

## Decisions Made

1. **uniqueIndex with .where() for partial indexes** - Drizzle 0.45.1 supports partial indexes via uniqueIndex builder pattern, not via unique() constraint
2. **Created observability package from scratch** - Package did not exist in the monorepo, created with full structure for Phase 14
3. **workspace_id as text without FK** - Cross-schema FKs can cause migration ordering issues per RESEARCH.md, workspace_id stored as text reference

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **Partial unique constraint syntax** - Initial attempt with `unique().where()` failed because Drizzle 0.45.1's `unique()` returns `UniqueConstraintBuilder` which doesn't have `.where()`. Switched to `uniqueIndex().where()` which works correctly for partial indexes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 13-03 (Credential Encryption):
- Credentials table defined with `encrypted_access_token`, `encrypted_refresh_token` columns
- `config.database.encryptionKey` available from 13-01
- Database schemas ready for migration generation
- Per-package db clients available for credential CRUD operations

---
*Phase: 13-data-layer*
*Completed: 2026-01-20*
