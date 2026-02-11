---
phase: 72-delegation-graph-observability
plan: 01
subsystem: ui
tags: [react, next.js, drizzle, recursive-cte, tanstack-table, dashboard]

# Dependency graph
requires:
  - phase: 70-task-delegation
    provides: tasks, taskHandoffs, entityDirectory tables in agents schema
  - phase: 71-completion-signaling
    provides: signal.orphaned event type, completion_result JSONB, active_delegations
provides:
  - Dashboard schema mirroring tasks, taskHandoffs, entityDirectory tables
  - Task tree service with recursive CTE, timeline events, health computation
  - GET /api/tasks/:taskId/tree API route for polling
  - /dashboard/tasks page with root task list, health badges, pagination
  - Tasks nav item in sidebar
affects: [72-02, 72-03, delegation-graph-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns: [recursive-cte-for-task-tree, flat-node-array-with-parentId, batch-health-computation]

key-files:
  created:
    - packages/dashboard/src/services/tasks.ts
    - packages/dashboard/src/app/api/tasks/[taskId]/tree/route.ts
    - packages/dashboard/src/app/tasks/page.tsx
    - packages/dashboard/src/app/tasks/loading.tsx
    - packages/dashboard/src/components/tasks/task-list-table.tsx
    - packages/dashboard/src/components/tasks/task-list-columns.tsx
    - packages/dashboard/src/components/tasks/task-health-badge.tsx
  modified:
    - packages/dashboard/src/lib/schema.ts
    - packages/dashboard/src/components/layout/sidebar.tsx
    - packages/dashboard/src/components/conversations/status-badge.tsx

key-decisions:
  - "Flat node array with parentId (not nested tree) -- client builds hierarchy, simpler SQL"
  - "Raw SQL for recursive CTE -- Drizzle ORM does not support WITH RECURSIVE natively"
  - "Task statuses added to shared StatusBadge config -- avoids duplicating badge component"
  - "Batch health via Promise.all per root -- simpler than complex batched SQL"
  - "task_id added to dashboard conversations table (Rule 3 blocking fix for tree joins)"

patterns-established:
  - "Task tree service pattern: recursive CTE returning flat nodes, client-side tree building"
  - "Health computation as pure function: testable severity calculation from nodes + events"
  - "Reuse DataTablePagination from conversations for consistent pagination UX"

# Metrics
duration: 6min
completed: 2026-02-11
---

# Phase 72 Plan 01: Task Data Foundation and List Page Summary

**Task tree service with recursive CTE, health computation, task list page at /dashboard/tasks with delegation health badges**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-11T01:19:01Z
- **Completed:** 2026-02-11T01:25:16Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Dashboard schema extended with tasks, taskHandoffs, entityDirectory tables mirroring canonical agents schema
- Task tree service providing recursive CTE query, delegation timeline events, health computation, and batch health for list page
- API route at GET /api/tasks/:taskId/tree returning nodes, events, and health JSON
- Working /dashboard/tasks page with root tasks showing description, entity, status, subtask count, health badges, and age
- Tasks nav item added to sidebar between Conversations and Agents

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema extension, task tree service, and polling API route** - `61a2562` (feat)
2. **Task 2: Task list page, sidebar navigation, health badge, and loading skeleton** - `7f37b8d` (feat)

## Files Created/Modified
- `packages/dashboard/src/lib/schema.ts` - Added tasks, taskHandoffs, entityDirectory tables; signal.orphaned event type; task_id to conversations
- `packages/dashboard/src/services/tasks.ts` - Task tree service: getTaskTree, getTaskTimeline, listRootTasks, computeTreeHealth, getRootTaskId, getTreeHealthForRoots
- `packages/dashboard/src/app/api/tasks/[taskId]/tree/route.ts` - API route returning tree nodes, events, and health
- `packages/dashboard/src/app/tasks/page.tsx` - Server component task list page with health data
- `packages/dashboard/src/app/tasks/loading.tsx` - Loading skeleton for task list
- `packages/dashboard/src/components/tasks/task-list-table.tsx` - Client table with @tanstack/react-table
- `packages/dashboard/src/components/tasks/task-list-columns.tsx` - Column definitions: description, entity, status, subtasks, health, age
- `packages/dashboard/src/components/tasks/task-health-badge.tsx` - Health badge: red (failure), amber (warning), empty (clean)
- `packages/dashboard/src/components/layout/sidebar.tsx` - Added Tasks nav item with ListChecks icon
- `packages/dashboard/src/components/conversations/status-badge.tsx` - Added task statuses (created, active, paused) to shared config

## Decisions Made
- Flat node array with parentId rather than nested tree from SQL -- simpler query, client builds hierarchy
- Raw SQL for recursive CTE since Drizzle ORM lacks native WITH RECURSIVE support
- Task statuses added to shared StatusBadge config to avoid duplicating badge component
- Batch health computation via Promise.all per root task -- simpler than batched SQL

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added task_id column to dashboard conversations table**
- **Found during:** Task 1 (Schema extension)
- **Issue:** Dashboard conversations table lacked task_id column needed for task tree JOIN (canonical schema has it since Phase 70)
- **Fix:** Added task_id text column to dashboard conversations schema definition
- **Files modified:** packages/dashboard/src/lib/schema.ts
- **Verification:** Typecheck passes, tree service JOIN compiles
- **Committed in:** 61a2562 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for task tree service to JOIN conversations to tasks. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Task tree service and API route ready for graph visualization (Plan 02)
- Health computation available for delegation graph health indicators
- Task list page provides base navigation to individual task detail/graph views

---
*Phase: 72-delegation-graph-observability*
*Completed: 2026-02-11*
