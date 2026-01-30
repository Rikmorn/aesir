---
phase: 29-database-schema-context-management
plan: 03
subsystem: context-management
tags: [drizzle, context-snapshots, task-store, dependency-injection, temporal-activities]

# Dependency graph
requires:
  - phase: 29-01
    provides: agents schema (contextSnapshots, tasks tables), ContextSnapshot/AgentTask types, createId generators
provides:
  - createContextManager() factory for semantic context snapshot persistence
  - createTaskStore() factory for structured agent task state persistence
  - WriteSnapshotParams, ContextManager, TaskStore, CreateTaskParams, TaskUpdate interfaces
  - CTXM-01 (write snapshot), CTXM-02 (task state), CTXM-03 (read latest), CTXM-04 (stage reads)
affects: [30-agent-tool-library, 31-dev-agent-orchestrator, 32-dev-agent-temporal-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Context snapshot write/read at Temporal activity boundaries for cross-activity continuity"
    - "camelCase-to-snake_case field mapping helper for Drizzle ORM updates"
    - "Defensive row existence check after insert().returning() for strictNullChecks"

key-files:
  created:
    - packages/agents/src/shared/db/context-manager.ts
    - packages/agents/src/shared/db/context-manager.test.ts
    - packages/agents/src/shared/db/task-store.ts
    - packages/agents/src/shared/db/task-store.test.ts
  modified:
    - packages/agents/src/shared/db/index.ts

decisions:
  - id: ctx-snapshot-write-read
    description: "Context snapshots written at activity end, read at next activity start -- enables continuity across Temporal approval waits"
  - id: field-mapping-helper
    description: "Separate mapUpdatesToColumns() helper converts camelCase TaskUpdate to snake_case Drizzle columns, skipping undefined values"
  - id: ctxm05-deferred
    description: "CTXM-05 (sub-agent context briefing) explicitly deferred to Phase 30/31 per 29-RESEARCH.md -- sub-agent briefs are in-memory only"
  - id: returning-row-guard
    description: "Guard against undefined row after insert().returning() -- required by exactOptionalPropertyTypes and strictNullChecks"

metrics:
  duration: ~6 minutes
  completed: 2026-01-30
---

# Phase 29 Plan 03: Context Manager & Task Store Summary

Context manager and task store factory services for persisting semantic context snapshots and structured task state to the agents PostgreSQL schema.

**One-liner:** createContextManager() and createTaskStore() factories with full CRUD, field mapping, health checks, and 32 tests.

## What Was Built

### Context Manager (`context-manager.ts`)
- **writeSnapshot()**: Inserts semantic context snapshots at Temporal activity boundaries with LLM summary, completed actions, pending intent, known issues, project context, key files, research findings, plan, and token/tool counts
- **readLatestSnapshot()**: Retrieves most recent snapshot by task_id + workflow_id (ordered by created_at DESC)
- **readLatestSnapshotForStage()**: Retrieves most recent snapshot by task_id + stage for targeted lookups
- **health()**: Database connectivity check with latency measurement
- **close()**: Graceful shutdown hook (no-op, pool managed externally)

### Task Store (`task-store.ts`)
- **createTask()**: Inserts new agent task records with external task ID, agent type, issue info, and Slack context
- **updateTask()**: Partial updates with camelCase-to-snake_case mapping; automatically adds updated_at timestamp; skips undefined fields
- **getTask()**: Lookup by external task_id
- **getTaskByWorkflowId()**: Lookup by Temporal workflow_id
- **health()**: Database connectivity check
- **close()**: Graceful shutdown hook

### Barrel Exports (`index.ts`)
Updated to export all three db service factories: context-manager, task-store, and trace-recorder.

## CTXM Coverage

| CTXM | Description | Status |
|------|-------------|--------|
| CTXM-01 | Write context snapshot at activity end | Implemented (writeSnapshot) |
| CTXM-02 | Structured task state persistence | Implemented (createTask, updateTask) |
| CTXM-03 | Read latest snapshot for continuity | Implemented (readLatestSnapshot) |
| CTXM-04 | Stage-specific snapshot reads | Implemented (readLatestSnapshotForStage) |
| CTXM-05 | Sub-agent context briefing | Deferred to Phase 30/31 (in-memory only per 29-RESEARCH.md) |

## Test Coverage

### Context Manager Tests (15 tests)
- Factory validation (db required, logger required)
- writeSnapshot: returns ID, validates required fields (taskId, workflowId, agentType, stage, summary), includes optional fields, handles defaults
- readLatestSnapshot: returns snapshot when found, returns null when empty
- readLatestSnapshotForStage: returns snapshot for stage, returns null when empty
- health: returns healthy with latency, returns unhealthy on DB error

### Task Store Tests (17 tests)
- Factory validation (db required, logger required)
- createTask: returns generated ID, validates required fields (taskId, agentType), includes optional fields
- updateTask: updates status, maps camelCase to snake_case, skips omitted fields, handles multiple fields, warns on empty update
- getTask: returns when found, returns null when not found
- getTaskByWorkflowId: returns when found, returns null when not found
- health: returns healthy, returns unhealthy on DB error

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fix TS18048 undefined row after returning()**
- **Found during:** Task 1
- **Issue:** Destructured `const [row]` from `.returning()` is possibly undefined under strictNullChecks
- **Fix:** Changed to `const rows = await ...returning()` then `const row = rows[0]` with explicit null guard and throw
- **Files modified:** context-manager.ts, task-store.ts
- **Commit:** 2a416d0

**2. [Rule 1 - Bug] Fix exactOptionalPropertyTypes test incompatibility**
- **Found during:** Task 2
- **Issue:** Test passed `branchName: undefined` explicitly which violates exactOptionalPropertyTypes (string type does not accept undefined)
- **Fix:** Changed test to omit the field entirely rather than setting it to undefined
- **Files modified:** task-store.test.ts
- **Commit:** dd4afb3

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 2a416d0 | feat | Implement context manager and task store services |
| dd4afb3 | test | Add comprehensive tests for context manager and task store |

## Next Phase Readiness

Phase 29 is now complete. All three plans delivered:
- 29-01: Schema, migration, DB client
- 29-02: Trace recorder factory
- 29-03: Context manager and task store factories

The agents database layer is ready for consumption by:
- Phase 30 (agent tool library) -- tools can persist context snapshots
- Phase 31 (dev agent orchestrator) -- orchestrator writes/reads context at activity boundaries
- Phase 32 (Temporal integration) -- activities use task store for lifecycle tracking
