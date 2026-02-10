---
phase: 70-task-delegation
plan: 01
subsystem: agents
tags: [delegation, tasks, pgvector, drizzle, timeout, worker-loop]

# Dependency graph
requires:
  - phase: 69-entity-directory
    provides: DirectoryService for entity validation, entity_directory table
  - phase: 58-task-primitive
    provides: TaskService, tasks table, task tools
provides:
  - task:delegate tool factory (createDelegateTaskTool)
  - DelegationDeps interface on ToolContext
  - depth column on agents.tasks (migration 0009)
  - MAX_DELEGATION_DEPTH constant (3)
  - seconds support in parseTimeoutDuration ("30s")
  - <delegation> XML block builder (buildDelegationBlock)
  - Worker loop DelegationDeps injection
affects: [70-02-handshake, 70-03-integration-test, 73-completion-signaling]

# Tech tracking
tech-stack:
  added: []
  patterns: [late-bound executor reference for delegation, delegation XML block protocol]

key-files:
  created:
    - packages/agents/src/shared/tools/task/delegate-task.ts
    - packages/agents/src/shared/db/migrations/0009_add_task_depth.sql
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/timeout-scheduler.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/shared/tools/task/types.ts
    - packages/agents/src/shared/tools/task/index.ts
    - packages/agents/src/service/main.ts

key-decisions:
  - "Late-bound executor: worker loop receives executor via options.executor (set by conversation-executor.ts after both are created)"
  - "Depth stored in both DB column and JSONB metadata: column for queries/indexing, metadata for delegation-specific context"
  - "task:delegate returns guidance to call wait_for with task_handshake type and 30s timeout"

patterns-established:
  - "DelegationDeps injection: follows SpawnAgentDeps pattern -- conditional on tool presence in definition"
  - "<delegation> XML block: structured initial message protocol for cross-agent delegation"

# Metrics
duration: 5min
completed: 2026-02-10
---

# Phase 70 Plan 01: Task Delegation Core Summary

**task:delegate tool with depth-enforced cross-agent delegation via executor.start(), <delegation> XML protocol, and 30s handshake timeout support**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T21:48:08Z
- **Completed:** 2026-02-10T21:53:55Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- task:delegate tool factory creates delegation tasks with depth tracking, validates target entities via DirectoryService, enforces MAX_DELEGATION_DEPTH=3, and starts target conversations
- DelegationDeps interface (executor, directoryService, taskService) injected into ToolContext by worker loop when agent has task:delegate
- Migration 0009 adds depth column to tasks table for O(1) depth lookup
- parseTimeoutDuration supports seconds ("30s") for handshake timeouts
- Tool registered as #45 in tool-factories.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration, DelegationDeps type, depth constant, and seconds timeout support** - `5ff6d80` (feat)
2. **Task 2: task:delegate tool factory, tool registration, and worker-loop DelegationDeps injection** - `5152c17` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/task/delegate-task.ts` - task:delegate tool factory with depth enforcement and <delegation> XML builder
- `packages/agents/src/shared/db/migrations/0009_add_task_depth.sql` - ALTER TABLE adds depth column with index
- `packages/agents/src/framework/types.ts` - DelegationDeps interface, delegationDeps on ToolContext, directoryService on ConversationExecutorOptions
- `packages/agents/src/framework/tool-factories.ts` - task:delegate registration (tool #45)
- `packages/agents/src/framework/worker-loop.ts` - DelegationDeps injection, DirectoryService + executor imports
- `packages/agents/src/framework/conversation-executor.ts` - Pass directoryService and executor to worker loop
- `packages/agents/src/framework/timeout-scheduler.ts` - Seconds unit ("s") support in parseTimeoutDuration
- `packages/agents/src/shared/db/schema.ts` - depth column on tasks table
- `packages/agents/src/shared/db/schema.drizzle.ts` - depth column mirror for drizzle-kit
- `packages/agents/src/shared/tools/task/types.ts` - MAX_DELEGATION_DEPTH=3 constant
- `packages/agents/src/shared/tools/task/index.ts` - Export createDelegateTaskTool and buildDelegationBlock
- `packages/agents/src/service/main.ts` - Pass directoryService to ConversationExecutor

## Decisions Made
- **Late-bound executor reference:** Worker loop receives `options.executor` which is set by conversation-executor.ts after both executor and worker loop are created. This avoids circular construction.
- **Depth in column + metadata:** The `depth` column enables indexed queries and O(1) depth checks. JSONB metadata carries `delegatedBy` for delegation-specific context.
- **task:delegate returns wait_for guidance:** The tool's success message suggests `wait_for` with type `task_handshake` and timeout `30s`, guiding the agent to the handshake pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed router test mock missing depth field**
- **Found during:** Task 1 (after adding depth column to schema)
- **Issue:** `createMockTask()` in `router.test.ts` did not include the new required `depth` field, causing TypeScript compilation failure
- **Fix:** Added `depth: 0` to the mock Task object
- **Files modified:** `packages/agents/src/router/router.test.ts`
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** `5ff6d80` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary for compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- task:delegate tool is compiled, registered, and wired
- Migration 0009 ready for `pnpm db:migrate`
- Seconds timeout support enables 30s handshake timeouts
- Plan 02 (accept/reject handshake) can build on DelegationDeps and delegation XML protocol
- Plan 03 (integration test) can verify end-to-end delegation flow

---
*Phase: 70-task-delegation*
*Completed: 2026-02-10*
