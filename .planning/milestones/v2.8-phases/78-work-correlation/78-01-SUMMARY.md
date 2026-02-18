---
phase: 78-work-correlation
plan: 01
subsystem: database
tags: [postgres, drizzle, zod, schema, migrations, jsonb, work-correlation]

# Dependency graph
requires: []
provides:
  - work_correlations table with composite PK and 3 indexes
  - knowledge_entries metadata JSONB column with GIN index
  - event.routed agent event type in schema and CHECK constraint
  - EntityRefSchema and entityRef on IncomingEvent
  - entity_update documented in KNOWN_SIGNAL_TYPES
  - WorkCorrelation and NewWorkCorrelation type exports
affects: [78-02, 78-03, 78-04, 78-05, 78-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite PK in SQL migration with unique constraint in Drizzle schema (Drizzle lacks composite PK support)"
    - "KNOWN_SIGNAL_TYPES const for documenting open-ended string signal types"

key-files:
  created:
    - packages/agents/src/shared/db/migrations/0014_add_work_correlations.sql
    - packages/agents/src/shared/db/migrations/0015_add_knowledge_metadata.sql
    - packages/agents/src/shared/db/migrations/0016_add_event_routed_type.sql
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/shared/db/migrations/meta/_journal.json
    - packages/agents/src/adapters/types.ts
    - packages/agents/src/framework/types.ts

key-decisions:
  - "Drizzle unique constraint mirrors SQL composite PK -- Drizzle ORM lacks composite PK support"
  - "JSONB default uses {} object not '{}' string -- Drizzle types require matching TS type for defaults"
  - "KNOWN_SIGNAL_TYPES as const array for discoverability without constraining signal type validation"

patterns-established:
  - "Composite PK pattern: real PK in migration SQL, unique constraint in Drizzle schema for parity"

requirements-completed: [CORR-01, CORR-02, CORR-07, CORR-08]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 78 Plan 01: Schema Foundations Summary

**work_correlations table, knowledge metadata JSONB column, event.routed event type, EntityRef on IncomingEvent, and entity_update signal type**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T23:05:48Z
- **Completed:** 2026-02-17T23:09:28Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Created work_correlations table with composite PK (entity_type, entity_id, conversation_id), FK to conversations, status CHECK constraint, and 3 lookup indexes
- Added metadata JSONB column with GIN index to knowledge_entries for entity-scoped knowledge tagging
- Extended agent event types with event.routed (schema arrays + migration CHECK constraint update)
- Added EntityRefSchema with typed entityType enum (linear_issue, github_pr, slack_thread) and optional entityRef field on IncomingEventSchema
- Documented all canonical signal types including entity_update in KNOWN_SIGNAL_TYPES const

## Task Commits

Each task was committed atomically:

1. **Task 1: Create work_correlations table, knowledge metadata, and event.routed migrations** - `8215c1c` (feat)
2. **Task 2: Add entityRef to IncomingEvent schema and entity_update signal type** - `fc3b393` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/schema.ts` - Added workCorrelations table, correlationStatusValues, metadata column on knowledgeEntries, event.routed event type, WorkCorrelation type exports
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirrored all schema.ts changes for drizzle-kit migration generation
- `packages/agents/src/shared/db/migrations/0014_add_work_correlations.sql` - Work correlations table DDL with composite PK and indexes
- `packages/agents/src/shared/db/migrations/0015_add_knowledge_metadata.sql` - Knowledge metadata JSONB column with GIN index
- `packages/agents/src/shared/db/migrations/0016_add_event_routed_type.sql` - Updated CHECK constraint to include event.routed
- `packages/agents/src/shared/db/migrations/meta/_journal.json` - Registered 3 new migrations at indices 13-15
- `packages/agents/src/adapters/types.ts` - Added EntityRefSchema, EntityRef type, entityRef field on IncomingEventSchema
- `packages/agents/src/framework/types.ts` - Added KNOWN_SIGNAL_TYPES const with entity_update, updated SignalSchema JSDoc

## Decisions Made
- **Drizzle unique constraint for composite PK:** Drizzle ORM does not support composite primary keys directly. The migration SQL uses a real `PRIMARY KEY (entity_type, entity_id, conversation_id)`, while the Drizzle schema uses `unique("uq_correlations_entity_conversation")` for type-level parity without destructive diffs.
- **JSONB default as object, not string:** The plan specified `default('{}')` but Drizzle's type system requires the default to match the `$type<>` annotation. Changed to `default({})` to pass typecheck.
- **KNOWN_SIGNAL_TYPES as documentation:** Rather than constraining signal types (which are already `z.string().min(1)`), added a `KNOWN_SIGNAL_TYPES` const array that serves as a grep-able reference without breaking open-ended signal extensibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed JSONB default type mismatch**
- **Found during:** Task 1 (schema.ts changes)
- **Issue:** Plan specified `default('{}')` (string) for metadata JSONB column, but Drizzle requires the default to match the `$type<Record<string, unknown>>()` annotation -- string is not assignable to `Record<string, unknown>`
- **Fix:** Changed to `default({})` in both schema.ts and schema.drizzle.ts
- **Files modified:** packages/agents/src/shared/db/schema.ts, packages/agents/src/shared/db/schema.drizzle.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** 8215c1c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Trivial type correction. No scope creep.

## Issues Encountered
- The adapters/types.ts file had already been modified (likely by a prior uncommitted change from the planner) with EntityRefSchema and entityRef additions. Verified the changes matched the plan specification and committed as-is.

## User Setup Required
None - no external service configuration required. Migrations must be applied via `pnpm db:migrate` when deploying.

## Next Phase Readiness
- All schema foundations in place for Plans 02-06
- work_correlations table ready for correlation service (Plan 02)
- EntityRef on IncomingEvent ready for adapter population (Plan 03)
- event.routed type ready for correlation router observability (Plan 04)
- entity_update signal type documented for correlation routing (Plan 04)
- knowledge metadata column ready for entity-scoped knowledge (Plan 05)

---
*Phase: 78-work-correlation*
*Completed: 2026-02-17*
