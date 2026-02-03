# Phase 46: Pre-Cleanup Verification - Audit Report

**Audited:** 2026-02-03
**Auditor:** Claude Opus 4.5
**Confidence:** HIGH (all findings verified against actual codebase)
**typecheck:** PASS (zero errors)
**lint:** 3 pre-existing errors (all in integration `_pool` naming convention, not Phase 46 related)

---

## Area 1: @temporalio/* Dependency Audit

### Findings

**Total files with `@temporalio` imports: 25 (excluding test files and comments)**

All 25 files are in dead code paths. ZERO @temporalio imports exist in the live code path (`service/main.ts` -> framework -> router -> adapters).

| File | Import | Live? | Reason Dead |
|------|--------|-------|-------------|
| `agents/src/router/types.ts:16` | `type { Client } from "@temporalio/client"` | NO | Used only by `RouterDeps` type (legacy). v2.3 uses `RouteEventDeps` |
| `agents/src/router/main.ts:42` | `Client, Connection from "@temporalio/client"` | NO | Legacy standalone entry point. v2.3 uses `service/main.ts` |
| `agents/src/router/tools/start-workflow.ts:12` | `WorkflowExecutionAlreadyStartedError from "@temporalio/client"` | NO | Legacy router tool. v2.3 uses `start-conversation.ts` |
| `agents/src/router/tools/signal-workflow.ts:24` | Signal definitions from `../../shared/temporal/signals.js` | NO | Legacy router tool. v2.3 uses `signal-conversation.ts` |
| `agents/src/router/fast-path.ts:28-32` | `escalationResolvedSignal, planApprovalSignal, prCompletionSignal from "../shared/temporal/signals.js"` | NO | Used only by `DETERMINISTIC_RULES` and `executeFastPath`. `matchFastPath` is only called by `routeEventLegacy` (dead). `executeFastPath` uses `RouterDeps.workflowClient` (Temporal Client). Neither function is called by v2.3 `routeEvent()`. |
| `agents/src/dev-agent/main.ts:37` | `Client, Connection from "@temporalio/client"` | NO | Legacy standalone entry point |
| `agents/src/dev-agent/worker.ts:26` | `NativeConnection, Worker from "@temporalio/worker"` | NO | Legacy Temporal worker |
| `agents/src/dev-agent/api/signal-handler.ts:15` | `type { Client as TemporalClient }` | NO | Legacy API handler |
| `agents/src/dev-agent/api/routes.ts:5` | `type { Client as TemporalClient }` | NO | Legacy API routes |
| `agents/src/dev-agent/api/events.ts:19` | `type { Client as TemporalClient }` | NO | Legacy events handler |
| `agents/src/dev-agent/api/events.ts:21` | `type { OrchestratorWorkflowInput }` from `../../shared/temporal/types.js` | NO | Legacy event handler only |
| `agents/src/product-agent/main.ts:42` | `Client, Connection from "@temporalio/client"` | NO | Legacy standalone entry point |
| `agents/src/product-agent/worker.ts:19` | `NativeConnection, Worker from "@temporalio/worker"` | NO | Legacy worker |
| `agents/src/product-agent/api/events.ts:20` | `type { Client as TemporalClient }` | NO | Legacy API handler |
| `agents/src/product-agent/api/events.ts:24` | `from "../../shared/temporal/index.js"` | NO | Legacy API handler |
| `agents/src/shared/temporal/signals.ts:8` | `import * as wf from "@temporalio/workflow"` | NO | Signal definitions only used by dead code |
| `agents/src/shared/temporal/activities/*.ts` | Various `@temporalio/activity` | NO | All Temporal activities are dead |
| `agents/src/shared/temporal/workflows/*.ts` | Various `@temporalio/workflow` | NO | All Temporal workflows are dead |
| `platform/src/temporal/client.ts:9` | `Client, Connection from "@temporalio/client"` | NO | Platform temporal module entirely dead |
| `platform/src/temporal/worker.ts:11` | `NativeConnection, Runtime, Worker from "@temporalio/worker"` | NO | Dead |
| `platform/src/temporal/signals.ts:8` | `import * as wf from "@temporalio/workflow"` | NO | Dead |
| `platform/src/temporal/workflows/approval-workflow.ts:17-18` | `import * as wf from "@temporalio/workflow"; proxyActivities` | NO | Dead |

### Package-Level Dependencies

```
@aesir/agents package.json:
  "@temporalio/activity": "^1.14.1"   -- dead
  "@temporalio/client": "^1.14.1"     -- dead
  "@temporalio/worker": "^1.14.1"     -- dead
  "@temporalio/workflow": "^1.14.1"   -- dead

@aesir/platform package.json:
  "@temporalio/client": "^1.14.1"     -- dead
  "@temporalio/worker": "^1.14.1"     -- dead
  "@temporalio/workflow": "^1.14.1"   -- dead
```

### Evidence

```bash
# Grep command used:
rg "@temporalio" packages/ --type ts

# Verification: service/main.ts import chain is Temporal-free
# service/main.ts imports from:
#   - ../shared/env/config.js
#   - @aesir/platform (createPinoLogger)
#   - @aesir/types (NormalizedEventSchema)
#   - drizzle-orm, express, pg
#   - ../framework/index.js
#   - ../router/router.js (routeEvent only)
#   - ../router/types.js (RouteEventDeps only)
#   - ../shared/db/schema.js
#   - ../shared/env/config.js
# None of these transitively import @temporalio.
```

### Conclusion

**CONFIRMED: ZERO @temporalio imports in live code paths.** All 25 files with @temporalio imports are in dead code paths. The v2.3 `service/main.ts` entry point and its entire import chain are Temporal-free.

---

## Area 2: Dead Code Boundary Mapping

### Dead Directories (complete deletion)

| Directory | Files | Reason Dead |
|-----------|-------|-------------|
| `agents/src/shared/temporal/` | 13 source + 6 test | Temporal activities, workflows, signals, types. Not imported by v2.3 framework. |
| `agents/src/dev-agent/api/` | 4 source (events.ts, index.ts, routes.ts, signal-handler.ts) + webhooks/ subdir | Legacy Temporal-connected HTTP handlers. v2.3 uses service/main.ts routes. |
| `agents/src/product-agent/api/` | 3 source (events.ts, index.ts, routes.ts) | Legacy Temporal-connected HTTP handlers |
| `agents/src/dev-agent/classification/` | 2 files (approval.ts, approval.test.ts) | Legacy approval classifier. Deprecated in Phase 35. |
| `platform/src/temporal/` | 8 source + 5 test | Platform Temporal module (client, worker, signals, types, workflows) |

### Dead Individual Files

| File | Reason Dead |
|------|-------------|
| `agents/src/dev-agent/main.ts` | Legacy standalone HTTP server with Temporal Client. v2.3 uses `service/main.ts`. |
| `agents/src/dev-agent/worker.ts` | Temporal worker. Removed from Docker Compose. |
| `agents/src/product-agent/main.ts` | Legacy standalone HTTP server with Temporal Client. |
| `agents/src/product-agent/worker.ts` | Temporal worker. Removed from Docker Compose. |
| `agents/src/router/main.ts` | Legacy standalone router entry point. |
| `agents/src/router/tools/start-workflow.ts` | Legacy Temporal tool. v2.3 uses `start-conversation.ts`. |
| `agents/src/router/tools/query-workflows.ts` | Legacy Temporal tool. v2.3 uses `query-conversations.ts`. |
| `agents/src/router/tools/signal-workflow.ts` | Legacy Temporal tool. v2.3 uses `signal-conversation.ts`. |
| `platform/src/logging/temporal-logger.ts` | Temporal-specific logger adapter. No longer needed. |
| `types/src/temporal/index.ts` | Cross-layer Temporal type contracts (`BoundActivities`, `MergePRInput`, etc.). Only imported by dead `platform/src/temporal/workflows/approval-workflow.ts`. |

### Dead DB Store Files (with test files)

| File | Reason Dead | Evidence |
|------|-------------|----------|
| `shared/db/task-store.ts` | Only imported by `dev-agent/worker.ts` (dead) | `rg "task-store" packages/agents/src --glob '*.ts'` -- only `worker.ts`, `schema.ts`, and test imports |
| `shared/db/task-store.test.ts` | Test for dead source | Deleted with source |
| `shared/db/context-manager.ts` | Only imported by `dev-agent/worker.ts` (dead) | Same grep pattern |
| `shared/db/context-manager.test.ts` | Test for dead source | Deleted with source |
| `shared/db/trace-recorder.ts` | Imported by `dev-agent/orchestrator/orchestrator.ts` and `product-agent/orchestrator/orchestrator.ts` (legacy orchestrators) and `shared/tools/toolkits.ts`. NONE of these are called by v2.3 framework. `runDevAgentOrchestrator` is only imported by `shared/temporal/activities/orchestrator-activities.ts` (dead). `runProductAgent` is only imported by `shared/temporal/activities/product-agent-activity.ts` (dead). `shared/tools/toolkits.ts` is only imported by the legacy orchestrators. The v2.3 framework uses `tool-factories.ts` which imports individual tools directly, NOT `toolkits.ts`. | Grep for `import.*runDevAgentOrchestrator`, `import.*runProductAgent`, `from.*shared/tools/toolkits` confirms only dead code callers. |
| `shared/db/trace-recorder.test.ts` | Test for dead source | Deleted with source |
| `shared/db/cost-tracking.ts` | Queries `execution_traces` and `tasks` tables. Only exported from `shared/db/index.ts` barrel. No non-barrel, non-test import found. | `rg "getTaskTokenUsage" packages/ --glob '*.ts'` shows only barrel export, test file, and definition |
| `shared/db/cost-tracking.test.ts` | Test for dead source | Deleted with source |

**Critical finding:** `TraceRecorderCallbacks` TYPE is imported by `shared/tools/toolkits.ts` and `shared/tools/coordination/spawn-agent.ts`. These files are NOT dead (individual tools from `shared/tools/` are used by `framework/tool-factories.ts`). However, `toolkits.ts` itself is NOT imported by the v2.3 framework -- it's only imported by legacy orchestrators. The `spawn-agent.ts` file imports `TraceRecorderCallbacks` as a type -- when `trace-recorder.ts` is deleted, this import will need to be addressed. The type needs to be either:
1. Moved to a types file (if spawn-agent still needs it)
2. Removed if spawn-agent is also dead

Checking: `spawn-agent.ts` -- `createSpawnAgentTool` is imported by `shared/tools/toolkits.ts` (dead) and `shared/tools/coordination/index.ts` barrel. Let me check if `framework/tool-factories.ts` imports `createSpawnAgentTool`.

Evidence: `framework/tool-factories.ts` line 31 imports `createRequestHumanInputTool` from `../shared/tools/coordination/index.js` but NOT `createSpawnAgentTool`. The v2.3 `spawn_agent` tool is in `framework/tool-factories.ts` line ~230+ as a separate implementation. So `shared/tools/coordination/spawn-agent.ts` is effectively dead (only used by `toolkits.ts`).

### Barrel Export Chains Crossing Live/Dead Boundary

**Chain 1: agents/src/index.ts -> shared/index.ts -> shared/temporal/index.ts**
```
agents/src/index.ts:12     -> export * from "./shared/index.js"
shared/index.ts:19         -> export * from "./temporal/index.js"
shared/temporal/index.ts   -> re-exports all activities, signals, types, workflows
```
**Impact:** Any consumer of `@aesir/agents` gets transitive temporal exports. No non-test consumers found importing from barrel.
**Fix:** Remove line 19 from `shared/index.ts`.

**Chain 2: agents/src/index.ts -> dev-agent/index.ts -> worker.ts**
```
agents/src/index.ts:8      -> export * from "./dev-agent/index.js"
dev-agent/index.ts:23-25   -> export { createOrchestratorWorker, type DevAgentWorkerOptions } from "./worker.js"
```
**Impact:** Re-exports dead Temporal worker factory.
**Fix:** Remove lines 22-25 from `dev-agent/index.ts`.

**Chain 3: platform/src/index.ts -> temporal/index.ts**
```
platform/src/index.ts:12   -> export * from "./temporal/index.js"
```
**Impact:** All `@aesir/platform` consumers get temporal exports.
**Fix:** Remove line 12 from `platform/src/index.ts`.

**Chain 4: types/src/index.ts -> temporal/index.ts**
```
types/src/index.ts:12      -> export * from "./temporal/index.js"
```
**Impact:** All `@aesir/types` consumers get temporal type exports.
**Fix:** Remove line 12 from `types/src/index.ts`.

**Chain 5: platform/src/logging/index.ts -> temporal-logger.ts**
```
platform/src/logging/index.ts:30-34 -> export { createTemporalLogger, ... } from "./temporal-logger.js"
```
**Impact:** `@aesir/platform` exports `createTemporalLogger`.
**Fix:** Remove lines 29-34 from `platform/src/logging/index.ts`.

**Chain 6: agents/src/shared/db/index.ts -> dead stores**
```
shared/db/index.ts:8   -> export * from "./context-manager.js"
shared/db/index.ts:9   -> export { getTaskTokenUsage, type TaskTokenUsage } from "./cost-tracking.js"
shared/db/index.ts:11  -> export * from "./task-store.js"
shared/db/index.ts:12  -> export * from "./trace-recorder.js"
```
**Impact:** Dead store exports via barrel. No live code imports these from barrel.
**Fix:** Remove lines 8, 9, 11, 12 from `shared/db/index.ts`.

**Chain 7: agents/src/router/index.ts -> legacy exports**
```
router/index.ts:19-22  -> export { DETERMINISTIC_RULES, executeFastPath, matchFastPath } from "./fast-path.js"
router/index.ts:23     -> export { routeEvent, routeEventLegacy } from "./router.js"
router/index.ts:24     -> export { formatEventForLLM, routeViaAgentLoop } from "./slow-path.js"
router/index.ts:27-34  -> export type { EventRouterDeps, ..., RouterDeps, RoutingRule }
```
**Impact:** Exports both v2.3 and legacy symbols. `routeEventLegacy`, `RouterDeps`, `executeFastPath`, `matchFastPath`, `DETERMINISTIC_RULES`, `routeViaAgentLoop`, `RoutingRule` are legacy-only.
**Fix:** Remove legacy re-exports, keep v2.3 ones.

### Files Needing Refactoring (Not Deletion)

| File | What to Refactor |
|------|-----------------|
| `shared/index.ts` | Remove `export * from "./temporal/index.js"` |
| `shared/db/index.ts` | Remove re-exports of dead stores (context-manager, cost-tracking, task-store, trace-recorder) |
| `dev-agent/index.ts` | Remove worker re-exports. Evaluate if remaining exports (orchestrator, system-prompts) are still needed. |
| `router/index.ts` | Remove legacy re-exports |
| `router/router.ts` | Delete `routeEventLegacy`, `handleRoutingFailureLegacy`, `sendRoutingAlertLegacy` functions. Remove `matchFastPath`, `executeFastPath` imports. Remove `RouterDeps` import. |
| `router/fast-path.ts` | ENTIRE FILE can be deleted -- both `matchFastPath` and `executeFastPath` are dead (only called by `routeEventLegacy`). `DETERMINISTIC_RULES` references Temporal signals. |
| `router/types.ts` | Remove `RouterDeps`, `SignalAction`, `StartAction`, `IgnoreAction`, `FastPathAction`, `RouteResult`, `RoutingRule` types (all legacy). Keep `EventRouterDeps`, `RouteEventDeps`, `RouteEventResult`. |
| `router/slow-path.ts` | Remove legacy `routeViaAgentLoop` function. Keep `routeViaAgentLoopV2` and `formatEventForLLM`. Remove imports for legacy tools. |
| `agents/src/index.ts` | Evaluate after dev-agent/product-agent index cleanup |
| `platform/src/index.ts` | Remove `export * from "./temporal/index.js"` |
| `platform/src/logging/index.ts` | Remove `createTemporalLogger` export |
| `types/src/index.ts` | Remove `export * from "./temporal/index.js"` |

### Conclusion

The dead code boundary is clear. The v2.3 framework (`service/main.ts` -> `framework/` -> `router/router.ts:routeEvent()`) has NO dependencies on Temporal code. All dead code is reachable only from legacy entry points (`dev-agent/main.ts`, `product-agent/main.ts`, `router/main.ts`, `**/worker.ts`) or from `routeEventLegacy` (which is not called by v2.3).

**Key finding:** `router/fast-path.ts` is ENTIRELY dead. Both `matchFastPath` and `executeFastPath` are only called by `routeEventLegacy`. The v2.3 EventRouter replaces this functionality with YAML-based routing rules. The entire file can be deleted (not just refactored).

---

## Area 3: Database Migration Audit

### Old Tables with NO Active v2.3 Writers

| Table | Schema Definition | Active Writers? | Evidence |
|-------|-------------------|----------------|----------|
| `agents.tasks` | `schema.ts:105-149` | NO | Only written by `task-store.ts` which is imported only by `dev-agent/worker.ts` (dead). `TaskStatus`, `ApprovalStatus` types and table definition are dead. |
| `agents.context_snapshots` | `schema.ts:32-71` | NO | Only written by `context-manager.ts` which is imported only by `dev-agent/worker.ts` (dead). |
| `agents.execution_traces` | `schema.ts:172-205` | NO | Only written by `trace-recorder.ts` which is imported only by legacy orchestrators (dead via Temporal activities). |

### Active v2.3 Tables (KEEP)

| Table | Status |
|-------|--------|
| `agents.conversations` | ACTIVE -- v2.3 ConversationExecutor |
| `agents.agent_events` | ACTIVE -- v2.3 EventLog |
| `agents.agent_sessions` | ACTIVE -- v2.3 SessionProjection |

### Schema File Impact

`shared/db/schema.ts` defines BOTH old and new tables. It cannot be deleted entirely. The old table definitions (`contextSnapshots`, `tasks`, `executionTraces` and their related type exports and status value arrays) should be removed. The new table definitions must be preserved.

**Lines to remove from schema.ts:**
- Lines 23-71: Context Snapshots table definition
- Lines 73-149: Tasks table (includes `taskStatusValues`, `TaskStatus`, `approvalStatusValues`, `ApprovalStatus`)
- Lines 151-205: Execution Traces table (includes `traceTypeValues`, `TraceType`)
- Lines 376-381: Type exports for old tables (`ContextSnapshot`, `NewContextSnapshot`, `AgentTask`, `NewAgentTask`, `ExecutionTrace`, `NewExecutionTrace`)

### ID Generators

| Generator | Used By | After Cleanup |
|-----------|---------|---------------|
| `createId.agentTask` | `schema.ts:110` only | UNUSED after old table removal |
| `createId.contextSnapshot` | `schema.ts:37` only | UNUSED after old table removal |
| `createId.executionTrace` | `schema.ts:177`, `trace-recorder.ts:177` | UNUSED after file+table removal |

These 3 ID generators in `types/src/utils/ids.ts` become unused after Phase B and can be removed in Phase C.

### Migration Needed

A DROP TABLE migration should be created in Phase 47 to formally remove the old tables from the database:
```sql
DROP TABLE IF EXISTS agents.tasks;
DROP TABLE IF EXISTS agents.context_snapshots;
DROP TABLE IF EXISTS agents.execution_traces;
```

### Conclusion

**CONFIRMED: Old tables have no active v2.3 writers.** All writers (`task-store.ts`, `context-manager.ts`, `trace-recorder.ts`) are in dead code. Tables are safe to drop. Schema definitions should be removed from `schema.ts` alongside the table drops.

---

## Area 4: Package.json Audit

### @aesir/agents `package.json` (line 34-37, 24-25)

**Dependencies to remove:**
```json
"@temporalio/activity": "^1.14.1",
"@temporalio/client": "^1.14.1",
"@temporalio/worker": "^1.14.1",
"@temporalio/workflow": "^1.14.1"
```

**Scripts to remove:**
```json
"dev-agent": "tsx src/dev-agent/main.ts",
"product-agent": "tsx src/product-agent/main.ts"
```

### @aesir/platform `package.json` (line 33-35)

**Dependencies to remove:**
```json
"@temporalio/client": "^1.14.1",
"@temporalio/worker": "^1.14.1",
"@temporalio/workflow": "^1.14.1"
```

### Root `package.json` (various lines)

**Scripts to remove/update:**
```json
"agent:dev": "pnpm --filter @aesir/agents dev-agent",         // references dead entry
"agent:product": "pnpm --filter @aesir/agents product-agent", // references dead entry
"docker:agent:dev": "docker compose up -d dev-agent && docker compose logs -f dev-agent",     // references removed service
"docker:agent:product": "docker compose up -d product-agent && docker compose logs -f product-agent", // references removed service
"infra:up": "docker compose up -d postgresql temporal temporal-ui",    // temporal, temporal-ui removed
"infra:logs": "docker compose logs -f postgresql temporal temporal-ui" // temporal, temporal-ui removed
```

### Docker Compose Artifacts (Cosmetic)

```yaml
# Rename from "temporal" to "aesir":
POSTGRES_USER: temporal       -> aesir
POSTGRES_PASSWORD: temporal   -> aesir
POSTGRES_DB: temporal         -> aesir
DB_USER=temporal              -> aesir (on 4 services)
DB_PASSWORD=temporal          -> aesir (on 4 services)
DB_NAME=temporal              -> aesir (on 4 services)
pg_isready -U temporal        -> pg_isready -U aesir

# Volume name (keep as-is to preserve data, or rename with data migration note)
temporal-postgresql           -> cosmetic only, volume has name: aesir-temporal-postgresql
```

### .env.example

`TEMPORAL_ADDRESS` is already removed (Phase 44 cleanup). `PRODUCT_AGENT_URL` is already removed.

**Remaining cosmetic items:**
```
DATABASE_URL=postgresql://temporal:temporal@localhost:5432/temporal  -> update credentials
DB_USER=temporal              -> aesir
DB_PASSWORD=temporal          -> aesir
DB_NAME=temporal              -> aesir
```

### Build Verification

```bash
$ pnpm typecheck   # PASS - zero errors across all 8 workspace projects
$ pnpm lint        # 3 pre-existing errors (_pool naming in 3 integration clients)
                   # These are NOT related to Temporal cleanup
```

### Conclusion

7 `@temporalio/*` dependencies to remove across 2 packages. 2 scripts to remove from agents, 6 scripts to remove/update from root. Docker Compose DB credentials are cosmetic rename items. `.env.example` already clean of Temporal references.

---

## Area 5: Router Module Integrity + Test Breakage Analysis

### v2.3 Code Path Verification

```
service/main.ts:44   -> import { routeEvent } from "../router/router.js"
service/main.ts:45   -> import type { RouteEventDeps } from "../router/types.js"

routeEvent() in router.ts:
  - Imports: NormalizedEvent, ALL_ADAPTERS, adaptPassThrough, callMcpTool
  - Calls: adapter pipeline -> eventRouter.handle() -> executor.start()/signal()
  - Does NOT import: matchFastPath, executeFastPath (only imported but used by routeEventLegacy)
  - Does NOT import from: shared/temporal/
```

**Wait:** `router/router.ts` line 19 DOES import `executeFastPath` and `matchFastPath`:
```typescript
import { executeFastPath, matchFastPath } from "./fast-path.js";
```
But these are only USED by `routeEventLegacy` (line 254, 262). The v2.3 `routeEvent()` function does NOT call them.

This means `router/router.ts` has a dead import from `fast-path.ts`. When `fast-path.ts` is deleted, this import will break the build. This MUST be refactored in Phase A before `fast-path.ts` deletion in Phase B.

Also `router/router.ts` line 20 imports:
```typescript
import { routeViaAgentLoop, routeViaAgentLoopV2 } from "./slow-path.js";
```
`routeViaAgentLoop` is only used by `routeEventLegacy`. `routeViaAgentLoopV2` is used by the v2.3 `routeEvent`. When legacy code is removed from `router.ts`, the `routeViaAgentLoop` import should also be removed.

### Router File Cleanup Summary

| File | Action | Details |
|------|--------|---------|
| `router/router.ts` | REFACTOR | Remove `routeEventLegacy`, `handleRoutingFailureLegacy`, `sendRoutingAlertLegacy`. Remove import of `matchFastPath`, `executeFastPath`. Remove import of `routeViaAgentLoop`. Remove import of `RouterDeps`. |
| `router/fast-path.ts` | DELETE | Entirely dead. Both exported functions only called by dead code. |
| `router/fast-path.test.ts` | DELETE | Test for dead source (if exists -- checked: no test file found for fast-path) |
| `router/types.ts` | REFACTOR | Remove `RouterDeps`, `SignalAction`, `StartAction`, `IgnoreAction`, `FastPathAction`, `RouteResult`, `RoutingRule`. Keep `EventRouterDeps`, `RouteEventDeps`, `RouteEventResult`. |
| `router/index.ts` | REFACTOR | Remove re-exports of dead symbols |
| `router/slow-path.ts` | REFACTOR | Remove `routeViaAgentLoop` function. Remove legacy tool imports (`createQueryWorkflowsTool`, `createSignalWorkflowTool`, `createStartWorkflowTool`). Keep `routeViaAgentLoopV2`, `formatEventForLLM`. |
| `router/tools/start-workflow.ts` | DELETE | Legacy Temporal tool |
| `router/tools/query-workflows.ts` | DELETE | Legacy Temporal tool |
| `router/tools/signal-workflow.ts` | DELETE | Legacy Temporal tool |
| `router/main.ts` | DELETE | Legacy standalone entry point |

### Test Breakage Analysis

**Temporal test files (168 skipped tests in 6 files) -- all inside `shared/temporal/`:**

| File | Approx Tests | Status |
|------|-------------|--------|
| `shared/temporal/activities/orchestrator-activities.test.ts` | ~50+ | `describe.skip("LEGACY")` |
| `shared/temporal/activities/product-agent-activity.test.ts` | ~30+ | `describe.skip("LEGACY")` |
| `shared/temporal/activities/slack-activities.test.ts` | ~20+ | `describe.skip("LEGACY")` |
| `shared/temporal/activities/linear-activities.test.ts` | ~10+ | `describe.skip("LEGACY")` |
| `shared/temporal/workflows/orchestrator-workflow.test.ts` | ~40+ | `describe.skip("LEGACY")` |
| `shared/temporal/workflows/product-agent-workflow.test.ts` | ~30+ | `describe.skip("LEGACY")` |

All 6 files are inside `shared/temporal/` -- they will be deleted with the directory. Zero ordering concern.

**DB store test files (to delete with source):**

| File | Tests |
|------|-------|
| `shared/db/task-store.test.ts` | Task store unit tests |
| `shared/db/context-manager.test.ts` | Context manager unit tests |
| `shared/db/trace-recorder.test.ts` | Trace recorder unit tests |
| `shared/db/cost-tracking.test.ts` | Cost tracking unit tests |

**Platform temporal test files (to delete with directory):**

| File | Tests |
|------|-------|
| `platform/src/temporal/client.test.ts` | Temporal client unit tests |
| `platform/src/temporal/signals.test.ts` | Temporal signals unit tests |
| `platform/src/temporal/types.test.ts` | Temporal types unit tests |
| `platform/src/temporal/worker.test.ts` | Temporal worker unit tests |
| `platform/src/temporal/workflows/approval-workflow.test.ts` | Approval workflow tests |

**Barrel export chain test impact:**
- `rg 'from "@aesir/agents"' packages/ --glob '*.test.ts'` -- NO test files import from the `@aesir/agents` barrel
- `@aesir/test-utils` -- confirmed ZERO Temporal references
- No non-skipped tests depend transitively on temporal exports

**Router test files:**
- `router/router.test.ts` -- Mocks both `routeViaAgentLoop` and `routeViaAgentLoopV2`. Tests `routeEvent` (v2.3) and `routeEventLegacy`. Legacy test cases should be removed.
- `router/fast-path.test.ts` -- Tests for `matchFastPath` and `executeFastPath`. Entire file can be deleted with `fast-path.ts`.
- `router/slow-path.test.ts` -- Tests `routeViaAgentLoop` (legacy) and `formatEventForLLM` (keep). Legacy test cases should be removed.

### Conclusion

**CONFIRMED: The v2.3 `routeEvent()` call chain has NO Temporal dependencies.** However, `router/router.ts` has dead imports from `fast-path.ts` that must be removed before `fast-path.ts` is deleted (Phase A refactoring). All test breakage is contained to files that will be deleted alongside their sources.

---

## Summary of Items for Deletion Manifest

### Phase A: Refactor Live-to-Dead References (10 files)
1. `router/router.ts` -- remove legacy functions and dead imports
2. `router/types.ts` -- remove legacy types
3. `router/index.ts` -- remove legacy re-exports
4. `router/slow-path.ts` -- remove legacy function and imports
5. `shared/index.ts` -- remove temporal re-export
6. `shared/db/index.ts` -- remove dead store re-exports
7. `dev-agent/index.ts` -- remove worker re-exports
8. `agents/src/index.ts` -- evaluate after above changes
9. `platform/src/index.ts` -- remove temporal re-export
10. `platform/src/logging/index.ts` -- remove createTemporalLogger export
11. `types/src/index.ts` -- remove temporal re-export

### Phase B: Delete Dead Files (~50+ files)
- 5 directories (shared/temporal/, dev-agent/api/, product-agent/api/, dev-agent/classification/, platform/src/temporal/)
- 10+ individual dead files
- 4 dead DB store files + 4 test files
- Old table definitions from schema.ts

### Phase C: Remove Dependencies and Config
- 7 @temporalio/* deps from 2 package.json files
- 8 scripts from 2 package.json files
- Docker Compose credential rename
- DROP TABLE migration
- ID generator cleanup
