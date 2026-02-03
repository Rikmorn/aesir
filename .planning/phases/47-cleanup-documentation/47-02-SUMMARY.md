---
phase: 47-cleanup-documentation
plan: 02
subsystem: agents-platform-types
tags: [cleanup, dead-code-deletion, temporal-removal, schema-refactor]
depends_on:
  requires: ["47-01"]
  provides: ["dead-code-deleted", "schema-v2.3-only", "temporal-free-codebase"]
  affects: ["47-03", "47-04"]
tech-stack:
  added: []
  removed: []
  patterns: ["surgical-deletion-with-pre-commit-validation"]
key-files:
  created: []
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/tools/coordination/coordination-tools.test.ts
  deleted:
    - packages/agents/src/shared/temporal/ (18 files)
    - packages/agents/src/dev-agent/ (24 files)
    - packages/agents/src/product-agent/ (12 files)
    - packages/platform/src/temporal/ (12 files)
    - packages/types/src/temporal/ (1 file)
    - packages/platform/src/logging/temporal-logger.ts
    - packages/agents/src/shared/db/task-store.ts (+test)
    - packages/agents/src/shared/db/context-manager.ts (+test)
    - packages/agents/src/shared/db/trace-recorder.ts (+test)
    - packages/agents/src/shared/db/cost-tracking.ts (+test)
    - packages/agents/src/shared/tools/toolkits.ts (+test)
    - packages/agents/src/shared/tools/coordination/spawn-agent.ts
    - packages/agents/src/router/fast-path.ts (+test)
    - packages/agents/src/router/main.ts
    - packages/agents/src/router/tools/start-workflow.ts
    - packages/agents/src/router/tools/query-workflows.ts
    - packages/agents/src/router/tools/signal-workflow.ts
decisions:
  - id: schema-drizzle-untouched
    decision: "schema.drizzle.ts left unchanged -- it is drizzle-kit's migration source of truth; removing old tables would generate destructive DROP TABLE migrations"
    rationale: "Database migration safety"
  - id: coordination-test-moved-to-task-1
    decision: "coordination-tools.test.ts edited in Task 1 commit (not Task 2) because pre-commit typecheck fails without it"
    rationale: "Rule 3 blocker -- spawn-agent.ts deleted in Task 1 but test file imports it"
metrics:
  duration: "4m29s"
  completed: "2026-02-03"
  files-deleted: 86
  lines-removed: ~21590
---

# Phase 47 Plan 02: Delete Dead Files and Directories Summary

**One-liner:** Deleted 86 files (21,590 lines) of dead Temporal workflows, legacy orchestrators, DB stores, and router tools; cleaned schema.ts to v2.3 tables only.

## Accomplishments

1. **Deleted 5 entire directories** of dead code:
   - `packages/agents/src/shared/temporal/` (18 files: Temporal activities, workflows, signals, types)
   - `packages/agents/src/dev-agent/` (24 files: API handlers, orchestrator, classification, worker, utils)
   - `packages/agents/src/product-agent/` (12 files: API handlers, orchestrator, worker)
   - `packages/platform/src/temporal/` (12 files: Temporal client, worker, approval workflow)
   - `packages/types/src/temporal/` (1 file: Temporal type exports)

2. **Deleted 18 individual dead files** across agents, platform, and router packages

3. **Cleaned schema.ts** to contain only v2.3 table definitions (conversations, agent_events, agent_sessions), removing contextSnapshots, tasks, executionTraces tables and their associated enums/types

4. **Surgically edited coordination-tools.test.ts** to keep only `createRequestHumanInputTool` tests (removed `createSpawnAgentTool` tests and all spawn-agent imports)

5. **Verified zero `@temporalio` references** remain in source files across agents, platform, and types packages

## Task Commits

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Delete all dead directories and files | `1c4cbea` | 86 files deleted (21,286 lines), coordination-tools.test.ts cleaned |
| 2 | Refactor schema.ts to v2.3 only | `17b4321` | Removed 3 legacy tables, 3 enum sets, 6 type exports from schema.ts |

## Files Changed

### Deleted (86 files)
- `packages/agents/src/shared/temporal/` -- 18 files (Temporal infrastructure)
- `packages/agents/src/dev-agent/` -- 24 files (legacy dev agent)
- `packages/agents/src/product-agent/` -- 12 files (legacy product agent)
- `packages/platform/src/temporal/` -- 12 files (platform Temporal layer)
- `packages/types/src/temporal/` -- 1 file (Temporal type definitions)
- `packages/platform/src/logging/temporal-logger.ts`
- `packages/agents/src/shared/db/{task-store,context-manager,trace-recorder,cost-tracking}.ts` (+tests, 8 files)
- `packages/agents/src/shared/tools/{toolkits,coordination/spawn-agent}.ts` (+test, 3 files)
- `packages/agents/src/router/{fast-path,main}.ts` (+test, 3 files)
- `packages/agents/src/router/tools/{start-workflow,query-workflows,signal-workflow}.ts` (3 files)

### Modified (2 files)
- `packages/agents/src/shared/db/schema.ts` -- Removed legacy table definitions (contextSnapshots, tasks, executionTraces)
- `packages/agents/src/shared/tools/coordination/coordination-tools.test.ts` -- Removed spawn-agent test block

## Decisions Made

1. **schema.drizzle.ts left unchanged** -- This file is drizzle-kit's migration source of truth. Removing old table definitions would cause drizzle-kit to generate destructive DROP TABLE migrations. Old tables remain in schema.drizzle.ts but are removed from the runtime schema.ts.

2. **coordination-tools.test.ts edit bundled with Task 1** -- The pre-commit hook runs typecheck, which fails if spawn-agent.ts is deleted but coordination-tools.test.ts still imports it. Edited the test file in the same commit as the deletions (Rule 3 blocker).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] coordination-tools.test.ts edit moved to Task 1**
- **Found during:** Task 1 commit attempt
- **Issue:** Pre-commit typecheck failed because coordination-tools.test.ts imports `spawn-agent.ts` which was just deleted
- **Fix:** Surgically edited coordination-tools.test.ts as part of Task 1 commit instead of Task 2
- **Files modified:** `packages/agents/src/shared/tools/coordination/coordination-tools.test.ts`
- **Commit:** `1c4cbea`

## Issues Encountered

None beyond the expected pre-commit hook ordering (documented as deviation above).

## Verification Results

- **GATE B:** `pnpm typecheck` passes (zero errors across all 8 workspace packages)
- **Lint:** Pre-commit lint passes. Full `pnpm lint` shows 3 pre-existing errors in unrelated files (history-manager.test.ts, docker-sandbox.test.ts, integration db clients)
- **@temporalio grep:** Zero results across agents, platform, types source files
- **Dead directories:** All 5 confirmed non-existent
- **Coordination tests:** All 6 `createRequestHumanInputTool` tests pass
- **Pre-existing test failures:** slow-path.test.ts (10 failures) and router.test.ts (0 tests) are pre-existing, unrelated to this plan

## Next Phase Readiness

Plan 47-03 (Phase C: Remove Dead Dependencies) is unblocked. All dead source files that imported `@temporalio/*` packages are now deleted. The package.json `dependencies` and `devDependencies` sections can be safely cleaned.

**Remaining directory structure:**
- `packages/agents/src/`: adapters/, framework/, router/, service/, shared/, index.ts
- `packages/agents/src/shared/`: agent-loop/, config/, db/, env/, mcp/, tools/, index.ts
- `packages/agents/src/router/`: router.ts, slow-path.ts, system-prompt.ts, types.ts, index.ts, tools/ (4 v2.3 files)
