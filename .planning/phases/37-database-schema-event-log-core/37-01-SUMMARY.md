---
phase: 37
plan: 01
subsystem: persistence
tags: [drizzle, postgresql, schema, migration, event-log, types]
requires: []
provides:
  - "3 new database tables (conversations, agent_events, agent_sessions)"
  - "Drizzle schema definitions with dual-file pattern"
  - "Migration SQL (0001_add_v23_tables.sql)"
  - "EventLog and SessionProjection interfaces"
  - "ID prefixes (agentEvent, agentSession, conversation)"
  - "Framework types module at packages/agents/src/framework/"
affects:
  - "37-02 (EventLog implementation depends on schema + interfaces)"
  - "37-03 (SessionProjection implementation depends on schema + interfaces)"
  - "38 (Agent definitions will reference AgentEventType)"
  - "40 (Executor will use conversations table directly)"
tech-stack:
  added: []
  patterns:
    - "Dual schema files (schema.ts + schema.drizzle.ts) for drizzle-kit compatibility"
    - "Framework types module for v2.3 interface contracts"
key-files:
  created:
    - "packages/agents/src/shared/db/migrations/0001_add_v23_tables.sql"
    - "packages/agents/src/framework/types.ts"
    - "packages/agents/src/framework/index.ts"
  modified:
    - "packages/types/src/utils/ids.ts"
    - "packages/agents/src/shared/db/schema.ts"
    - "packages/agents/src/shared/db/schema.drizzle.ts"
    - "packages/agents/src/shared/db/migrations/meta/_journal.json"
key-decisions:
  - decision: "Add executor columns (claimed_by, claimed_at, last_heartbeat_at) to conversations table now"
    rationale: "Single migration is cleaner than two sequential migrations for the same table; columns have NULL defaults and don't affect Phase 37 scope"
  - decision: "Use snake_case for Drizzle property names matching existing codebase convention"
    rationale: "Consistency with existing schema.ts patterns (task_id, workflow_id, agent_type)"
  - decision: "Framework types module uses import type for schema module to keep runtime imports minimal"
    rationale: "Only agentEventTypeValues needs a runtime re-export; all other imports are type-only"
duration: 4m39s
completed: 2026-02-01
---

# Phase 37 Plan 01: Database Schema, Migration, and Framework Types Summary

Drizzle schema for 3 v2.3 tables (conversations, agent_events, agent_sessions) with idempotent migration SQL, 9 typed event types, and EventLog/SessionProjection interface contracts.

## Performance

- **Duration:** 4m39s
- **Start:** 2026-02-01T18:58:14Z
- **End:** 2026-02-01T19:02:53Z
- **Tasks:** 2/2
- **Files created:** 3
- **Files modified:** 4

## Accomplishments

1. **ID Prefixes** -- Added `agentEvent` (`aevt_`), `agentSession` (`sess_`), and `conversation` (`conv_`) to the `createId` factory in `@aesir/types`, maintaining alphabetical order with existing entries.

2. **Database Schema** -- Defined 3 new tables in `schema.ts` using the existing `agentsSchema` pgSchema:
   - `conversations` -- executor state with messages, status, pending_wait, queued_signals, plus Phase 40 executor columns (claimed_by, claimed_at, last_heartbeat_at)
   - `agent_events` -- append-only event log with gapless per-conversation sequence (UNIQUE constraint), 9 typed event types, JSONB payload, token/duration metrics
   - `agent_sessions` -- materialized projection keyed by conversation_id with status, timing, and JSONB artifacts

3. **Dual Schema** -- Mirrored all 3 tables in `schema.drizzle.ts` with inline nanoid (no `@aesir/types` dependency) for drizzle-kit migration generation.

4. **Migration SQL** -- Created `0001_add_v23_tables.sql` following the idempotent pattern from migration 0000: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, updated_at triggers for conversations and agent_sessions (not agent_events -- append-only).

5. **Framework Types** -- Created `packages/agents/src/framework/types.ts` defining:
   - `EventLog` interface: append(), query(), subscribe(), initSequence(), flush(), close()
   - `SessionProjection` interface: getSession(), close()
   - `AppendEventInput` -- caller-facing event input type (omits auto-generated fields)
   - `EventQueryOptions`, `EventSubscriptionFilter`, `EventSubscriptionHandler`, `Unsubscribe`
   - `ArtifactExtractionConfig`, `ArtifactExtractor` -- Phase 38 integration point for tool-to-artifact mapping
   - `EventLogOptions`, `SessionProjectionOptions` -- factory constructor options

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add ID prefixes, database schema tables, and migration | `da79d94` | ids.ts, schema.ts, schema.drizzle.ts, 0001_add_v23_tables.sql, _journal.json |
| 2 | Create framework types module | `ff1af9a` | framework/types.ts, framework/index.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/db/migrations/0001_add_v23_tables.sql` | Migration creating 3 tables with indexes, constraints, triggers |
| `packages/agents/src/framework/types.ts` | EventLog, SessionProjection interfaces and related types |
| `packages/agents/src/framework/index.ts` | Framework module barrel export |

## Files Modified

| File | Change |
|------|--------|
| `packages/types/src/utils/ids.ts` | Added agentEvent, agentSession, conversation ID generators |
| `packages/agents/src/shared/db/schema.ts` | Added conversations, agentEvents, agentSessions tables + type exports |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Mirrored 3 new tables for drizzle-kit |
| `packages/agents/src/shared/db/migrations/meta/_journal.json` | Added entry for 0001_add_v23_tables |

## Decisions Made

1. **Executor columns added to conversations now** -- claimed_by, claimed_at, last_heartbeat_at columns added to conversations table in this migration rather than deferring to Phase 40. Single migration is cleaner; columns are nullable with no impact on Phase 37.

2. **Snake_case Drizzle property names** -- Matched existing codebase convention (task_id, workflow_id, agent_type) rather than the camelCase used in the research examples. This keeps the schema file consistent.

3. **Framework types use import type** -- Only `agentEventTypeValues` is a runtime re-export. All interface definitions use `import type` to minimize runtime overhead.

4. **ArtifactExtractor with payloadPath** -- SessionProjectionOptions accepts an `ArtifactExtractionConfig` map with explicit `artifactKey` and `payloadPath` fields, keeping Phase 37 independent of Phase 38's ToolRegistry. Phase 38 will construct this config from tool definitions.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

1. **TypeScript project reference rebuild required** -- After adding ID prefixes to `@aesir/types`, the `@aesir/agents` typecheck failed because it referenced stale declaration files. Fixed by building `@aesir/types` first (`pnpm --filter @aesir/types run build`). This is the expected behavior with TypeScript project references.

2. **Biome import ordering** -- Pre-commit hook caught that `import type * as agentsSchemaModule` must precede `import type { ... }` from the same module. Fixed by reordering imports in framework/types.ts.

## Next Phase Readiness

Plan 37-02 (EventLog implementation) can proceed immediately:
- Schema tables and type exports are available from `../shared/db/schema.js`
- EventLog interface contract is defined in `../framework/types.js`
- EventLogOptions type specifies all constructor dependencies
- No blockers or concerns
