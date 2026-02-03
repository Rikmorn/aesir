# Phase 46: Deletion Manifest for Phase 47

**Created:** 2026-02-03
**Source:** 46-AUDIT-REPORT.md findings
**Purpose:** Ordered deletion plan with typecheck gates for Phase 47 execution

---

## Overview

Three phases with typecheck gates between each:
- **Phase A:** Refactor live-to-dead references (11 steps)
- **Phase B:** Delete dead files and directories (12 steps)
- **Phase C:** Remove dependencies and config artifacts (8 steps)

Total estimated files affected: ~80+

---

## PHASE A: Refactor Live-to-Dead References

Remove all imports and re-exports that cross the live/dead boundary. After this phase, all dead code is isolated -- no live file references any dead file.

### Step A1: Clean router/router.ts

**Action:** refactor
**Files:** `packages/agents/src/router/router.ts`
**Risk:** LOW -- removing dead functions, keeping live `routeEvent`

**Current imports to remove (lines 19-20, 25):**
```typescript
import { executeFastPath, matchFastPath } from "./fast-path.js";
import { routeViaAgentLoop, routeViaAgentLoopV2 } from "./slow-path.js";
// ...
import type { RouteEventDeps, RouteEventResult, RouteResult, RouterDeps } from "./types.js";
```

**After:**
```typescript
import { routeViaAgentLoopV2 } from "./slow-path.js";
// ...
import type { RouteEventDeps, RouteEventResult, RouteResult } from "./types.js";
```

**Functions to delete:**
- `routeEventLegacy` (lines 241-291)
- `handleRoutingFailureLegacy` (lines 296-320)
- `sendRoutingAlertLegacy` (lines 325-363)

**Functions to keep:**
- `routeEvent` (v2.3, lines 48-159)
- `handleRoutingError` (v2.3, lines 169-180)
- `sendRoutingAlertV2` (v2.3, lines 189-227)

---

### Step A2: Clean router/types.ts

**Action:** refactor
**Files:** `packages/agents/src/router/types.ts`
**Risk:** LOW -- removing types only used by dead code

**Remove:**
- Line 16: `import type { Client } from "@temporalio/client";`
- Lines 29-38: `RouterDeps` interface (uses `Client` type)
- Lines 49-57: `SignalAction` interface
- Lines 63-78: `StartAction` interface
- Lines 85-89: `IgnoreAction` interface
- Lines 97: `FastPathAction` type alias
- Lines 131-138: `RoutingRule` interface

**Keep:**
- `RouteResult` (lines 109-118) -- used by v2.3 `routeViaAgentLoopV2`
- `EventRouterDeps` (lines 149-158)
- `RouteEventDeps` (lines 172-183)
- `RouteEventResult` (lines 189-205)

---

### Step A3: Clean router/index.ts

**Action:** refactor
**Files:** `packages/agents/src/router/index.ts`
**Risk:** LOW -- removing re-exports of deleted items

**Before:**
```typescript
export { DETERMINISTIC_RULES, executeFastPath, matchFastPath } from "./fast-path.js";
export { routeEvent, routeEventLegacy } from "./router.js";
export { formatEventForLLM, routeViaAgentLoop } from "./slow-path.js";
export { ROUTER_SYSTEM_PROMPT } from "./system-prompt.js";
export type {
  EventRouterDeps, FastPathAction, RouteEventDeps, RouteEventResult,
  RouteResult, RouterDeps, RoutingRule,
} from "./types.js";
```

**After:**
```typescript
export { routeEvent } from "./router.js";
export { formatEventForLLM, routeViaAgentLoopV2 } from "./slow-path.js";
export { ROUTER_SYSTEM_PROMPT_V2 } from "./system-prompt.js";
export type {
  EventRouterDeps, RouteEventDeps, RouteEventResult, RouteResult,
} from "./types.js";
```

---

### Step A4: Clean router/slow-path.ts

**Action:** refactor
**Files:** `packages/agents/src/router/slow-path.ts`
**Risk:** LOW -- removing legacy function and its imports

**Remove:**
- Line 19: `ROUTER_SYSTEM_PROMPT` import (keep `ROUTER_SYSTEM_PROMPT_V2`)
- Line 23: `import { createQueryWorkflowsTool }` (legacy tool)
- Line 26: `import { createSignalWorkflowTool }` (legacy tool)
- Line 28: `import { createStartWorkflowTool }` (legacy tool)
- Line 29: Remove `RouterDeps` from type import (keep `EventRouterDeps`, `RouteResult`)
- Lines 78-157: Delete entire `routeViaAgentLoop` function

**Keep:**
- `formatEventForLLM` (lines 46-56) -- used by both, and tests
- `routeViaAgentLoopV2` (lines 178-262) -- v2.3 live code

---

### Step A5: Clean router/system-prompt.ts

**Action:** refactor
**Files:** `packages/agents/src/router/system-prompt.ts`
**Risk:** LOW -- removing legacy prompt constant

**Remove:**
- `ROUTER_SYSTEM_PROMPT` constant (the legacy prompt referencing Temporal workflow tools)

**Keep:**
- `ROUTER_SYSTEM_PROMPT_V2` (v2.3 prompt referencing conversation tools)

---

### Step A6: Clean shared/index.ts

**Action:** refactor
**Files:** `packages/agents/src/shared/index.ts`
**Risk:** LOW -- no live code imports temporal from this barrel

**Remove line 19:**
```typescript
export * from "./temporal/index.js";
```

---

### Step A7: Clean shared/db/index.ts

**Action:** refactor
**Files:** `packages/agents/src/shared/db/index.ts`
**Risk:** LOW -- no v2.3 code imports dead store functions

**Remove lines 8, 9, 11, 12:**
```typescript
export * from "./context-manager.js";
export { getTaskTokenUsage, type TaskTokenUsage } from "./cost-tracking.js";
export * from "./task-store.js";
export * from "./trace-recorder.js";
```

**Keep:**
```typescript
export { closeDatabase, db } from "./client.js";
export * from "./schema.js";
```

---

### Step A8: Clean dev-agent/index.ts

**Action:** refactor
**Files:** `packages/agents/src/dev-agent/index.ts`
**Risk:** LOW -- worker exports are dead code

**Remove lines 22-25:**
```typescript
// Worker
export {
  createOrchestratorWorker,
  type DevAgentWorkerOptions,
} from "./worker.js";
```

**Keep:**
- `runDevAgentOrchestrator` and system prompt exports (these will become dead after Phase B when `shared/temporal/activities/orchestrator-activities.ts` is deleted, but they are not harmful to keep temporarily)

**Note:** After Phase B deletes the temporal activities that call `runDevAgentOrchestrator`, the dev-agent orchestrator becomes dead code too. However, because the orchestrator files don't import from `@temporalio/*` directly, they won't block typecheck. They can be cleaned up in a follow-up pass if desired. The immediate priority is removing Temporal imports from the compilation path.

---

### Step A9: Clean platform/src/index.ts

**Action:** refactor
**Files:** `packages/platform/src/index.ts`
**Risk:** LOW -- no v2.3 code imports platform temporal

**Remove line 12:**
```typescript
export * from "./temporal/index.js";
```

---

### Step A10: Clean platform/src/logging/index.ts

**Action:** refactor
**Files:** `packages/platform/src/logging/index.ts`
**Risk:** LOW -- createTemporalLogger not used by v2.3

**Remove lines 29-34:**
```typescript
// Temporal adapter
export {
  createTemporalLogger,
  type TemporalLoggerInterface,
  type TemporalLogLevel,
} from "./temporal-logger.js";
```

---

### Step A11: Clean types/src/index.ts

**Action:** refactor
**Files:** `packages/types/src/index.ts`
**Risk:** LOW -- no v2.3 code imports types temporal module

**Remove line 12:**
```typescript
export * from "./temporal/index.js";
```

---

### GATE A: `pnpm typecheck && pnpm lint`

After all Phase A steps, run typecheck and lint. Expected: PASS. All references to soon-to-be-deleted files have been removed from live code paths. Dead files still exist but are no longer referenced by any barrel export or live import.

---

## PHASE B: Delete Dead Files and Directories

All files deleted in this phase are isolated (no live code references them after Phase A). Order matters slightly for test runner clarity but not for compilation.

### Step B1: Delete agents/src/shared/temporal/ (entire directory)

**Action:** delete
**Files:**
- `packages/agents/src/shared/temporal/index.ts`
- `packages/agents/src/shared/temporal/signals.ts`
- `packages/agents/src/shared/temporal/types.ts`
- `packages/agents/src/shared/temporal/activities/index.ts`
- `packages/agents/src/shared/temporal/activities/infrastructure-activities.ts`
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.ts`
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.test.ts`
- `packages/agents/src/shared/temporal/activities/product-agent-activity.ts`
- `packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts`
- `packages/agents/src/shared/temporal/activities/linear-activities.ts`
- `packages/agents/src/shared/temporal/activities/linear-activities.test.ts`
- `packages/agents/src/shared/temporal/activities/slack-activities.ts`
- `packages/agents/src/shared/temporal/activities/slack-activities.test.ts`
- `packages/agents/src/shared/temporal/workflows/index.ts`
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts`
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.test.ts`
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts`
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.test.ts`

**Why dead:** Temporal activities/workflows. Workers removed from Docker Compose. v2.3 uses ConversationExecutor.
**Tests deleted:** ~168 skipped tests across 6 test files
**Risk:** LOW -- all references removed in Phase A

---

### Step B2: Delete agents/src/dev-agent/api/ (entire directory)

**Action:** delete
**Files:**
- `packages/agents/src/dev-agent/api/index.ts`
- `packages/agents/src/dev-agent/api/routes.ts`
- `packages/agents/src/dev-agent/api/events.ts`
- `packages/agents/src/dev-agent/api/signal-handler.ts`
- `packages/agents/src/dev-agent/api/webhooks/` (entire subdirectory, check contents)

**Why dead:** Legacy Temporal-connected HTTP handlers. v2.3 uses `service/main.ts`.
**Risk:** LOW

---

### Step B3: Delete agents/src/product-agent/api/ (entire directory)

**Action:** delete
**Files:**
- `packages/agents/src/product-agent/api/index.ts`
- `packages/agents/src/product-agent/api/routes.ts`
- `packages/agents/src/product-agent/api/events.ts`

**Why dead:** Legacy Temporal-connected HTTP handlers.
**Risk:** LOW

---

### Step B4: Delete agents/src/dev-agent/classification/ (entire directory)

**Action:** delete
**Files:**
- `packages/agents/src/dev-agent/classification/approval.ts`
- `packages/agents/src/dev-agent/classification/approval.test.ts`

**Why dead:** Legacy approval classifier. Deprecated since Phase 35.
**Risk:** LOW

---

### Step B5: Delete legacy entry points and workers

**Action:** delete
**Files:**
- `packages/agents/src/dev-agent/main.ts`
- `packages/agents/src/dev-agent/worker.ts`
- `packages/agents/src/product-agent/main.ts`
- `packages/agents/src/product-agent/worker.ts`
- `packages/agents/src/router/main.ts`

**Why dead:** Legacy standalone entry points. v2.3 uses `service/main.ts` as sole entry.
**Risk:** LOW

---

### Step B6: Delete legacy router tools and fast-path

**Action:** delete
**Files:**
- `packages/agents/src/router/tools/start-workflow.ts`
- `packages/agents/src/router/tools/query-workflows.ts`
- `packages/agents/src/router/tools/signal-workflow.ts`
- `packages/agents/src/router/fast-path.ts`
- `packages/agents/src/router/fast-path.test.ts` (if exists, check)

**Why dead:** Temporal-based router tools. v2.3 uses conversation-based tools. `fast-path.ts` entirely dead after Phase A removes its callers from `router.ts`.
**Risk:** LOW

---

### Step B7: Delete platform/src/temporal/ (entire directory)

**Action:** delete
**Files:**
- `packages/platform/src/temporal/index.ts`
- `packages/platform/src/temporal/client.ts`
- `packages/platform/src/temporal/client.test.ts`
- `packages/platform/src/temporal/worker.ts`
- `packages/platform/src/temporal/worker.test.ts`
- `packages/platform/src/temporal/signals.ts`
- `packages/platform/src/temporal/signals.test.ts`
- `packages/platform/src/temporal/types.ts`
- `packages/platform/src/temporal/types.test.ts`
- `packages/platform/src/temporal/workflows/index.ts`
- `packages/platform/src/temporal/workflows/approval-workflow.ts`
- `packages/platform/src/temporal/workflows/approval-workflow.test.ts`

**Why dead:** Platform Temporal module. v2.3 doesn't use any platform temporal functionality.
**Risk:** LOW

---

### Step B8: Delete platform/src/logging/temporal-logger.ts

**Action:** delete
**Files:**
- `packages/platform/src/logging/temporal-logger.ts`

**Why dead:** Temporal-specific logger adapter. Export removed in Phase A step A10.
**Risk:** LOW

---

### Step B9: Delete types/src/temporal/ (entire directory)

**Action:** delete
**Files:**
- `packages/types/src/temporal/index.ts`

**Why dead:** Cross-layer Temporal type contracts. Only imported by `platform/src/temporal/workflows/approval-workflow.ts` (deleted in Step B7).
**Risk:** LOW

---

### Step B10: Delete dead DB store files

**Action:** delete
**Files:**
- `packages/agents/src/shared/db/task-store.ts`
- `packages/agents/src/shared/db/task-store.test.ts`
- `packages/agents/src/shared/db/context-manager.ts`
- `packages/agents/src/shared/db/context-manager.test.ts`
- `packages/agents/src/shared/db/trace-recorder.ts`
- `packages/agents/src/shared/db/trace-recorder.test.ts`
- `packages/agents/src/shared/db/cost-tracking.ts`
- `packages/agents/src/shared/db/cost-tracking.test.ts`

**Why dead:** All four stores serve old tables only. No v2.3 code imports them (confirmed in audit). Barrel exports removed in Phase A step A7.

**Note on TraceRecorderCallbacks:** The TYPE `TraceRecorderCallbacks` is imported by:
1. `shared/tools/toolkits.ts` -- only imported by legacy orchestrators (dead after B1/B5)
2. `shared/tools/coordination/spawn-agent.ts` -- only imported by `toolkits.ts` (dead)

Neither will cause typecheck failure after Phase A because:
- `toolkits.ts` is not barrel-exported after Phase A (it was never in a barrel -- imported directly by legacy orchestrators which are deleted in B5)
- The TypeScript compiler only checks files reachable from the compilation root

**However:** If `tsconfig.json` includes all `src/**/*.ts` files (which it likely does), then `toolkits.ts` and `spawn-agent.ts` will still be typechecked even though they're dead code. This means deleting `trace-recorder.ts` MAY cause typecheck failure in `toolkits.ts`.

**Mitigation options:**
1. Also delete `shared/tools/toolkits.ts` and `shared/tools/toolkits.test.ts` in this step (they are dead code)
2. Or replace the import in `toolkits.ts` with a local interface definition

**Recommendation:** Delete `shared/tools/toolkits.ts` and `shared/tools/toolkits.test.ts` as they are dead code (only imported by legacy orchestrators that are deleted in B5). Also check if `shared/tools/coordination/spawn-agent.ts` needs the same treatment -- the v2.3 framework has its own `spawn_agent` tool in `framework/tool-factories.ts`.

---

### Step B11: Remove old table definitions from schema.ts

**Action:** refactor
**Files:** `packages/agents/src/shared/db/schema.ts`
**Risk:** MEDIUM -- must preserve active table definitions

**Remove:**
- Lines 23-71: `contextSnapshots` table definition (entire Context Snapshots section)
- Lines 73-97: `taskStatusValues`, `TaskStatus`, `approvalStatusValues`, `ApprovalStatus`
- Lines 105-149: `tasks` table definition (entire Tasks section)
- Lines 151-163: `traceTypeValues`, `TraceType`
- Lines 172-205: `executionTraces` table definition (entire Execution Traces section)
- Lines 376-381: Type exports for old tables (`ContextSnapshot`, `NewContextSnapshot`, `AgentTask`, `NewAgentTask`, `ExecutionTrace`, `NewExecutionTrace`)

**Keep:**
- `agentsSchema` (line 21)
- `conversations` table (lines 207-271)
- `agentEvents` table (lines 273-334)
- `agentSessions` table (lines 336-372)
- Type exports for kept tables (lines 382-387)

**Note:** The `createId` import on line 10 is used by both old and new table definitions. After removing old tables, verify `createId` is still needed (yes -- `agentEvents` uses `createId.agentEvent()` on line 303).

---

### Step B12: Clean up dead shared/tools files

**Action:** delete
**Files:**
- `packages/agents/src/shared/tools/toolkits.ts`
- `packages/agents/src/shared/tools/toolkits.test.ts`

**Why dead:** `createOrchestratorToolkit` and `createProductAgentToolkit` are only imported by legacy orchestrators (`dev-agent/orchestrator/orchestrator.ts` and `product-agent/orchestrator/orchestrator.ts`). The v2.3 framework uses `framework/tool-factories.ts` instead.

**Also check:** `shared/tools/coordination/spawn-agent.ts` imports `TraceRecorderCallbacks`. If it breaks typecheck, check if it's also dead code. The v2.3 `spawn_agent` tool is in `framework/tool-factories.ts`. If the legacy `spawn-agent.ts` is also dead, delete it.

**Risk:** MEDIUM -- verify no framework imports from these specific files first

---

### GATE B: `pnpm typecheck && pnpm lint`

After all Phase B steps, run typecheck and lint. Expected: PASS. All deleted files should have no remaining references.

If typecheck fails, likely causes:
1. `shared/tools/toolkits.ts` or `shared/tools/coordination/spawn-agent.ts` still typechecked and referencing deleted `trace-recorder.ts`
2. Any test file with stale imports

Fix strategy: Delete any file that only fails because its dependency was deleted in this phase (it was dead code kept alive by compilation).

---

## PHASE C: Remove Dependencies and Config Artifacts

### Step C1: Remove @temporalio dependencies from agents package.json

**Action:** remove-dependency
**Files:** `packages/agents/package.json`
**Risk:** LOW

**Remove from `dependencies`:**
```json
"@temporalio/activity": "^1.14.1",
"@temporalio/client": "^1.14.1",
"@temporalio/worker": "^1.14.1",
"@temporalio/workflow": "^1.14.1"
```

**Remove from `scripts`:**
```json
"dev-agent": "tsx src/dev-agent/main.ts",
"product-agent": "tsx src/product-agent/main.ts"
```

---

### Step C2: Remove @temporalio dependencies from platform package.json

**Action:** remove-dependency
**Files:** `packages/platform/package.json`
**Risk:** LOW

**Remove from `dependencies`:**
```json
"@temporalio/client": "^1.14.1",
"@temporalio/worker": "^1.14.1",
"@temporalio/workflow": "^1.14.1"
```

---

### Step C3: Clean root package.json scripts

**Action:** refactor
**Files:** `package.json`
**Risk:** LOW

**Remove:**
```json
"agent:dev": "pnpm --filter @aesir/agents dev-agent",
"agent:product": "pnpm --filter @aesir/agents product-agent",
"docker:agent:dev": "docker compose up -d dev-agent && docker compose logs -f dev-agent",
"docker:agent:product": "docker compose up -d product-agent && docker compose logs -f product-agent",
"infra:up": "docker compose up -d postgresql temporal temporal-ui",
"infra:logs": "docker compose logs -f postgresql temporal temporal-ui"
```

**Replace `infra:up` and `infra:logs` with:**
```json
"infra:up": "docker compose up -d postgresql",
"infra:logs": "docker compose logs -f postgresql"
```

---

### Step C4: Rename Docker Compose DB credentials

**Action:** refactor
**Files:** `docker-compose.yml`
**Risk:** MEDIUM -- requires database volume recreation or ALTER USER

**Changes:**
```yaml
# PostgreSQL service
POSTGRES_USER: temporal     -> POSTGRES_USER: aesir
POSTGRES_PASSWORD: temporal -> POSTGRES_PASSWORD: aesir
POSTGRES_DB: temporal       -> POSTGRES_DB: aesir

# healthcheck
pg_isready -U temporal      -> pg_isready -U aesir

# All 4 service environments (linear, github, slack, agent-service)
DB_USER=temporal            -> DB_USER=aesir
DB_PASSWORD=temporal        -> DB_PASSWORD=aesir
DB_NAME=temporal            -> DB_NAME=aesir
```

**Volume name:** Keep `temporal-postgresql` / `aesir-temporal-postgresql` to preserve existing data. Renaming the volume would require data migration.

**IMPORTANT:** This change requires either:
1. Destroying and recreating the database volume: `docker compose down -v && docker compose up -d`
2. OR running ALTER USER and ALTER DATABASE in the existing PostgreSQL instance before applying changes

**Recommendation:** Include instructions in the PR for developers to recreate their volumes.

---

### Step C5: Update .env.example DB credentials

**Action:** refactor
**Files:** `.env.example`
**Risk:** LOW

**Update:**
```
DATABASE_URL=postgresql://temporal:temporal@localhost:5432/temporal
->
DATABASE_URL=postgresql://aesir:aesir@localhost:5432/aesir

DB_USER=temporal     -> DB_USER=aesir
DB_PASSWORD=temporal -> DB_PASSWORD=aesir
DB_NAME=temporal     -> DB_NAME=aesir
```

---

### Step C6: Create DROP TABLE migration

**Action:** create
**Files:** `packages/agents/src/shared/db/migrations/XXXX_drop_legacy_tables.sql` (or via drizzle-kit generate)
**Risk:** MEDIUM -- data loss for old tables (intended)

```sql
-- Drop legacy Temporal-era tables
-- These tables have no active v2.3 writers (confirmed in 46-AUDIT-REPORT.md)
DROP TABLE IF EXISTS agents.execution_traces;
DROP TABLE IF EXISTS agents.context_snapshots;
DROP TABLE IF EXISTS agents.tasks;
```

**Note:** Run via `pnpm --filter @aesir/agents db:migrate` after applying.

---

### Step C7: Remove unused ID generators

**Action:** refactor
**Files:** `packages/types/src/utils/ids.ts`
**Risk:** LOW -- confirmed unused after Phase B

**Remove:**
```typescript
/** Agent task ID (agents.tasks) */
agentTask: () => `atask_${nanoid()}`,

/** Context snapshot ID (agents.context_snapshots) */
contextSnapshot: () => `ctx_${nanoid()}`,

/** Execution trace ID (agents.execution_traces) */
executionTrace: () => `trace_${nanoid()}`,
```

**Verify:** After removing, run typecheck to confirm no code references these generators.

---

### Step C8: Run pnpm install to clean lockfile

**Action:** install
**Files:** `pnpm-lock.yaml`
**Risk:** LOW

```bash
pnpm install
```

This removes @temporalio packages from node_modules and updates the lockfile.

---

### GATE C: `pnpm typecheck && pnpm lint && pnpm test:fast`

After all Phase C steps, run full verification. Expected: PASS. All Temporal dependencies removed, old tables dropped, ID generators cleaned.

`pnpm test:fast` expected changes:
- ~168 skipped temporal tests removed (deleted with shared/temporal/)
- ~4 DB store test files removed (deleted with store files)
- ~5 platform temporal test files removed (deleted with platform/src/temporal/)
- ~2 classification test files removed
- Router test files cleaned (legacy test cases removed)

---

## Phase 47 Execution Guidance

### Recommended Plan Structure

**Plan 47-01: Phase A (Refactor references)**
- Steps A1-A11 in a single plan
- All refactoring, no deletions
- Gate: `pnpm typecheck && pnpm lint`
- Estimated: 30-45 min

**Plan 47-02: Phase B (Delete dead files)**
- Steps B1-B12
- All deletions
- Gate: `pnpm typecheck && pnpm lint`
- Estimated: 20-30 min

**Plan 47-03: Phase C (Dependencies and config)**
- Steps C1-C8
- Dependencies, config, migrations
- Gate: `pnpm typecheck && pnpm lint && pnpm test:fast`
- Estimated: 30-45 min

### Parallelization Opportunities

**Within Phase A:**
- Steps A6-A11 (barrel export cleanups) can be done in parallel -- they touch different packages
- Steps A1-A5 (router cleanup) should be sequential -- they reference each other

**Within Phase B:**
- Steps B1-B9 (directory/file deletions) can be done in any order after Phase A gate passes
- Step B10 (DB store files) depends on Phase A step A7
- Step B11 (schema.ts) should be last in Phase B (most careful refactoring)
- Step B12 (toolkits cleanup) should be done alongside B10

**Within Phase C:**
- Steps C1-C3 (package.json) can be done in parallel
- Step C4 (Docker Compose) is independent
- Steps C5-C7 are independent
- Step C8 (pnpm install) must be last

### Test Breakage Expectations

| Category | Files Deleted | Tests Removed |
|----------|--------------|---------------|
| Temporal activities (skipped) | 4 test files | ~110 |
| Temporal workflows (skipped) | 2 test files | ~58 |
| DB stores | 4 test files | ~60+ |
| Platform temporal | 5 test files | ~40+ |
| Classification | 1 test file | ~10+ |
| Router fast-path | 1 test file | ~20+ |
| Router tests (partial cleanup) | 0 files deleted, 2 refactored | Legacy cases removed |
| Toolkits | 1 test file | ~20+ |
| **Total** | **~18 test files** | **~300+ tests** |

All removed tests are for dead code. No live v2.3 tests should be affected.

### Typecheck Gate Stop Points

1. After Phase A (all 11 steps): `pnpm typecheck && pnpm lint`
2. After Phase B (all 12 steps): `pnpm typecheck && pnpm lint`
3. After Phase C (all 8 steps): `pnpm typecheck && pnpm lint && pnpm test:fast`

If any gate fails, stop and investigate. The three-phase structure ensures that:
- Phase A failures indicate a missed import reference
- Phase B failures indicate a file that was still referenced (should have been caught in A)
- Phase C failures indicate a dependency issue or test regression

### Edge Cases to Watch

1. **tsconfig includes pattern:** If `tsconfig.json` uses `"include": ["src/**/*.ts"]`, dead code files will still be typechecked even after removing barrel exports. This is why Phase B step B10/B12 may need to handle `toolkits.ts` and `spawn-agent.ts`.

2. **Drizzle migration generation:** After removing table definitions from `schema.ts` (B11), running `drizzle-kit generate` will produce a migration that drops the tables. This should be the same as the manually created migration in C6. Use one or the other, not both.

3. **Docker volume data:** Step C4 changes DB credentials. Existing development volumes will need to be recreated (`docker compose down -v`). Document this in the PR description.

4. **pnpm install failure:** Step C8 may fail if @temporalio packages have peer dependency requirements that are satisfied by other packages. Run `pnpm install --no-strict-peer-dependencies` if needed (unlikely since we're removing, not adding).
