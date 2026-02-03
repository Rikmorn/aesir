---
phase: 47
plan: 03
subsystem: infrastructure
tags: [cleanup, dependencies, credentials, migrations, drizzle]
depends_on:
  requires: ["47-01", "47-02"]
  provides: "Clean dependency tree, aesir credentials everywhere, consolidated v2.3 migrations"
  affects: ["47-04"]
tech-stack:
  removed: ["@temporalio/activity", "@temporalio/client", "@temporalio/worker", "@temporalio/workflow"]
  patterns: ["credential-rename", "migration-consolidation"]
key-files:
  modified:
    - packages/agents/package.json
    - packages/platform/package.json
    - package.json
    - docker-compose.yml
    - .env.example
    - packages/agents/drizzle.config.ts
    - packages/platform/drizzle.config.ts
    - packages/observability/drizzle.config.ts
    - packages/integrations/linear/drizzle.config.ts
    - packages/integrations/github/drizzle.config.ts
    - packages/integrations/slack/drizzle.config.ts
    - packages/agents/src/shared/db/migrations/0000_create_agents_schema.sql
    - packages/agents/src/shared/db/migrations/meta/_journal.json
    - packages/types/src/utils/ids.ts
    - pnpm-lock.yaml
  deleted:
    - packages/agents/src/shared/db/migrations/0001_add_v23_tables.sql
    - packages/agents/src/shared/db/migrations/meta/0000_snapshot.json
decisions:
  - "Consolidated migrations create clean-slate v2.3 schema -- fresh clones get only v2.3 tables"
  - "Volume renamed from temporal-postgresql to aesir-postgresql -- existing devs must docker compose down -v"
  - "Pre-existing lint errors (3) and test failures (10) documented but not fixed -- not introduced by this plan"
metrics:
  duration: "~5m"
  completed: "2026-02-03"
---

# Phase 47 Plan 03: Remove Dependencies, Config Cleanup, Migration Consolidation Summary

**One-liner:** Removed all @temporalio dependencies, renamed DB credentials temporal->aesir everywhere, consolidated agents migrations to clean-slate v2.3, and pruned legacy ID generators.

## Accomplishments

### Task 1: Remove @temporalio dependencies, clean package.json, remove legacy ID generators
- Removed 4 @temporalio packages from `@aesir/agents` dependencies (activity, client, worker, workflow)
- Removed 3 @temporalio packages from `@aesir/platform` dependencies (client, worker, workflow)
- Removed dead `dev-agent` and `product-agent` scripts from agents package.json (directories deleted in 47-02)
- Removed `agent:dev`, `agent:product`, `docker:agent:dev`, `docker:agent:product` from root package.json
- Updated `infra:up` and `infra:logs` scripts to postgresql only (no temporal references)
- Replaced `langchain`/`langgraph` keywords with `conversation-executor`
- Removed 3 legacy ID generators from ids.ts: `agentTask`, `contextSnapshot`, `executionTrace`
- Fixed inconsistent JSON indentation in package.json files (caused by previous plan's text edits)

### Task 2: Credential rename, drizzle configs, migration consolidation
- Renamed all PostgreSQL credentials from `temporal` to `aesir` in docker-compose.yml (POSTGRES_USER, DB_USER, etc.)
- Renamed volume from `temporal-postgresql` to `aesir-postgresql`
- Updated healthcheck from `pg_isready -U temporal` to `pg_isready -U aesir`
- Updated .env.example with aesir credentials (DATABASE_URL, DB_USER, DB_PASSWORD, DB_NAME)
- Updated all 6 drizzle configs to default to `aesir` credentials
- Consolidated migration 0000 to clean-slate v2.3 schema (conversations, agent_events, agent_sessions)
- Deleted migration 0001 (content merged into 0000)
- Deleted meta/0000_snapshot.json (drizzle regenerates)
- Updated meta/_journal.json: 2 entries (0000_create_agents_schema at idx 0, 0002_add_executor_columns at idx 1)
- Ran pnpm prune removing @temporalio from node_modules and lockfile

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Remove @temporalio deps, scripts, ID generators | `9b4e03b` | package.json (x3), ids.ts |
| 2 | Credential rename, drizzle configs, migration consolidation | `a7efe34` | docker-compose.yml, .env.example, 6 drizzle configs, migrations, pnpm-lock.yaml |

## Verification Results

### GATE C
- **Typecheck:** All 8 workspace packages pass (0 errors)
- **Lint:** Pre-existing 3 errors in unrelated files (history-manager.test.ts, docker-sandbox.test.ts, integration db/client.ts `_pool` naming). Not introduced by this plan.
- **Test:fast:** 809 tests pass, 10 pre-existing failures in router/slow-path.test.ts and router.test.ts (`routeViaAgentLoop is not a function`). Not introduced by this plan.

### Credential Verification
- `grep "temporal" docker-compose.yml` -- 0 matches
- `grep "temporal" .env.example` -- 0 matches
- `grep '"temporal"' packages/*/drizzle.config.ts packages/integrations/*/drizzle.config.ts` -- 0 matches
- `grep "@temporalio" pnpm-lock.yaml` -- 0 matches

### Migration Verification
- `0000_create_agents_schema.sql` -- consolidated v2.3 schema (conversations, agent_events, agent_sessions)
- `0001_add_v23_tables.sql` -- DELETED (merged into 0000)
- `0002_add_executor_columns.sql` -- unchanged
- `meta/_journal.json` -- 2 entries (idx 0: 0000, idx 1: 0002)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed inconsistent JSON indentation in package.json files**
- **Found during:** Task 1
- **Issue:** `dotenv-flow` in agents/package.json and `dockerode` in platform/package.json had broken indentation (no leading spaces), likely caused by text deletion in prior plans
- **Fix:** Restored proper 4-space indentation
- **Files modified:** packages/agents/package.json, packages/platform/package.json
- **Commit:** `9b4e03b`

**2. [Rule 1 - Bug] Fixed inconsistent indentation in root package.json**
- **Found during:** Task 1
- **Issue:** `docker:build` and `infra:up` lines had no leading spaces
- **Fix:** Restored proper 4-space indentation
- **Files modified:** package.json
- **Commit:** `9b4e03b`

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Consolidated migrations create clean-slate v2.3 schema | Fresh clones only get conversations, agent_events, agent_sessions -- no legacy context_snapshots/tasks/execution_traces |
| Volume renamed temporal-postgresql -> aesir-postgresql | Existing devs must `docker compose down -v` to recreate with new name |
| Pre-existing test/lint failures not fixed in this plan | Not introduced by plan 47-03; documented as pre-existing in STATE.md Pending Todos |

## Next Phase Readiness

### Blockers
None.

### Ready For
- Plan 47-04: CLAUDE.md update to reflect all v2.3 cleanup changes
- Fresh clone validation: `docker compose down -v && docker compose up -d postgresql && pnpm db:migrate` creates v2.3 tables only
