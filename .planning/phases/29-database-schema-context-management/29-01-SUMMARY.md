---
phase: 29
plan: 01
subsystem: agents-database
tags: [drizzle-orm, postgresql, schema, migration, database]
dependency_graph:
  requires: []
  provides:
    - "agents PostgreSQL schema namespace with 3 tables"
    - "createId generators for ctx_, atask_, trace_ prefixes"
    - "Database client factory for agents schema queries"
    - "Hand-written SQL migration for agents schema"
    - "drizzle.config.ts for agents schema management"
  affects:
    - "29-02 (context manager and task store services)"
    - "29-03 (trace recorder service)"
tech_stack:
  added:
    - "pg ^8.17.2 (PostgreSQL client for drizzle-orm/node-postgres driver)"
    - "drizzle-kit ^0.31.8 (dev dependency for migration execution)"
    - "@types/pg (dev dependency)"
  patterns:
    - "pgSchema namespace isolation (agents.*)"
    - "Dual schema files (schema.ts + schema.drizzle.ts)"
    - "Text IDs with nanoid prefixes (ctx_, atask_, trace_)"
    - "Hand-written SQL migration with drizzle-kit meta"
key_files:
  created:
    - "packages/agents/src/shared/db/schema.ts"
    - "packages/agents/src/shared/db/schema.drizzle.ts"
    - "packages/agents/src/shared/db/client.ts"
    - "packages/agents/src/shared/db/index.ts"
    - "packages/agents/drizzle.config.ts"
    - "packages/agents/src/shared/db/migrations/0000_create_agents_schema.sql"
    - "packages/agents/src/shared/db/migrations/meta/_journal.json"
    - "packages/agents/src/shared/db/migrations/meta/0000_snapshot.json"
  modified:
    - "packages/types/src/utils/ids.ts"
    - "packages/agents/package.json"
    - "packages/agents/src/shared/index.ts"
    - "pnpm-lock.yaml"
decisions:
  - id: "29-01-D1"
    decision: "Used enum option in text() for status/type columns"
    rationale: "Drizzle text with enum provides type safety at the ORM level while keeping PostgreSQL columns as plain text (no enum type creation needed)"
  - id: "29-01-D2"
    decision: "Used drizzle-kit generate to produce snapshot, then adapted for hand-written migration"
    rationale: "Hand-written SQL is more readable but drizzle-kit needs a valid snapshot to track schema state for future migrations"
  - id: "29-01-D3"
    decision: "Alphabetized createId entries in ids.ts"
    rationale: "Improves readability and makes it easier to find entries as the list grows"
metrics:
  duration: "5m 17s"
  completed: "2026-01-30"
---

# Phase 29 Plan 01: Database Schema & Migration Setup Summary

Drizzle ORM schema with 3 tables (context_snapshots, tasks, execution_traces) in agents PostgreSQL namespace, plus pg client, hand-written migration, and drizzle-kit config.

## Performance

- **Duration:** 5 minutes 17 seconds
- **Tasks:** 2/2 complete
- **Deviations:** 0

## Accomplishments

### Task 1: Add ID generators and create Drizzle ORM schema files
- Added 3 new `createId` entries to `@aesir/types`: `contextSnapshot` (ctx_), `agentTask` (atask_), `executionTrace` (trace_)
- Alphabetized all existing createId entries for consistency
- Created `schema.ts` with 3 Drizzle ORM table definitions:
  - `contextSnapshots` -- 17 columns including JSONB typed fields for semantic context
  - `tasks` -- 19 columns with typed enum status/approval columns
  - `executionTraces` -- 15 columns with parent/child agent correlation
- Created `schema.drizzle.ts` mirror without `@aesir/types` imports (inline nanoid)
- Exported 6 TypeScript types via `$inferSelect` and `$inferInsert` patterns
- Defined enum value arrays and types: `TaskStatus`, `ApprovalStatus`, `TraceType`

### Task 2: Create DB client, drizzle config, migration, and scripts
- Created `client.ts` following exact platform/db/client.ts pattern (lazy Pool, drizzle-orm/node-postgres)
- Created barrel `index.ts` with exports sorted per Biome rules
- Added db re-export to `shared/index.ts`
- Created `drizzle.config.ts` targeting agents schema namespace with `__drizzle_agents_migrations` tracking table
- Added `db:migrate` script to package.json
- Installed `pg` (runtime), `drizzle-kit` and `@types/pg` (dev)
- Hand-wrote SQL migration with:
  - `CREATE SCHEMA IF NOT EXISTS "agents"`
  - 3 `CREATE TABLE IF NOT EXISTS` statements with proper defaults
  - 8 `CREATE INDEX IF NOT EXISTS` statements
  - `update_updated_at_column()` trigger function
  - 2 `updated_at` triggers (context_snapshots, tasks)
- Created migration meta files (journal + snapshot from drizzle-kit generate)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add ID generators and Drizzle ORM schema files | 1737399 | ids.ts, schema.ts, schema.drizzle.ts |
| 2 | Create DB client, drizzle config, migration, and scripts | 97503ef | client.ts, index.ts, drizzle.config.ts, migration SQL, package.json |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/db/schema.ts` | Drizzle ORM table definitions with @aesir/types imports |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Drizzle Kit schema mirror (no external deps) |
| `packages/agents/src/shared/db/client.ts` | Database client factory with pg Pool |
| `packages/agents/src/shared/db/index.ts` | Barrel exports for db module |
| `packages/agents/drizzle.config.ts` | Drizzle Kit config for agents schema |
| `packages/agents/src/shared/db/migrations/0000_create_agents_schema.sql` | Hand-written initial migration |
| `packages/agents/src/shared/db/migrations/meta/_journal.json` | Migration journal |
| `packages/agents/src/shared/db/migrations/meta/0000_snapshot.json` | Schema snapshot for drizzle-kit |

## Files Modified

| File | Change |
|------|--------|
| `packages/types/src/utils/ids.ts` | Added 3 new createId entries, alphabetized all entries |
| `packages/agents/package.json` | Added pg, drizzle-kit, @types/pg deps and db:migrate script |
| `packages/agents/src/shared/index.ts` | Added db module re-export |
| `pnpm-lock.yaml` | Updated lockfile for new dependencies |

## Decisions Made

1. **Used `text()` with `enum` option for status/type columns** -- Provides ORM-level type safety while keeping PostgreSQL columns as plain text. No need to create PostgreSQL enum types, which are harder to modify later.

2. **Generated snapshot via drizzle-kit, adapted for hand-written migration** -- The hand-written SQL is more readable and includes idempotent `IF NOT EXISTS` clauses plus trigger functions that drizzle-kit cannot generate. Used drizzle-kit generate to produce the snapshot JSON that tracks schema state for future migrations.

3. **Alphabetized createId entries** -- Reordered the existing entries in `ids.ts` from insertion-order to alphabetical order. Improves scanability as the list grows.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues

None.

## Next Phase Readiness

Plan 29-02 (context manager and task store services) can proceed immediately. All schema definitions, types, and database client are in place. The migration is ready to apply via `pnpm --filter @aesir/agents db:migrate` when PostgreSQL is running.
