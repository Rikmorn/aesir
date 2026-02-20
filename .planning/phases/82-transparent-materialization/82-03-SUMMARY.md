---
phase: 82-transparent-materialization
plan: 03
subsystem: api, database
tags: [materialization, linear, mcp, correlation, forward-sync, status-mapping]

# Dependency graph
requires:
  - phase: 82-transparent-materialization
    plan: 01
    provides: MaterializationAdapter interface, materialization_records table, Linear MCP extensions
provides:
  - LinearMaterializationAdapter factory (create/syncStatus/handleWebhook)
  - ForwardSyncListener for async status propagation to Linear
  - Work correlation registration on materialized issues (comment routing + parent resolution)
affects: [82-04, 82-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [lazy-label-resolution, team-resolution-chain, fire-and-forget-sync]

key-files:
  created:
    - packages/agents/src/shared/services/materialization/linear-adapter.ts
    - packages/agents/src/shared/services/materialization/forward-sync.ts
  modified:
    - packages/agents/src/shared/services/materialization/index.ts
    - packages/agents/src/shared/services/materialization/types.ts

key-decisions:
  - "agent-work label resolved lazily on first create() and cached for adapter lifetime"
  - "handleWebhook is synchronous per interface; caller resolves materialization record context"
  - "parentIssueId type changed to string | undefined for exactOptionalPropertyTypes compatibility"

patterns-established:
  - "Lazy label resolution: resolve external labels once on first use, cache for lifetime"
  - "Team resolution chain: explicit teamId > parent issue team > default fallback"
  - "Forward sync composition: separate listener alongside TaskSignalDispatcher, not mixed in"

requirements-completed: [MAT-02, MAT-05]

# Metrics
duration: 4min
completed: 2026-02-20
---

# Phase 82 Plan 03: Linear Materialization Adapter and Forward Sync Summary

**LinearMaterializationAdapter creating Linear issues via MCP with priority/label/team resolution, work correlation registration, status sync, and webhook signal translation, plus ForwardSyncListener for async terminal-state propagation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T23:01:06Z
- **Completed:** 2026-02-20T23:05:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- LinearMaterializationAdapter creates Linear issues with description, priority mapping, label resolution, team resolution chain, and optional sub-issue creation via parentId
- Work correlation (linear_issue) registered on every successful create() enabling comment routing and parent issue resolution
- syncStatus() maps active/completed/cancelled to Linear state types (started/completed/canceled) and updates materialization record
- handleWebhook() translates Linear status changes and assignee changes into domain signals (task_cancelled, materialization_status_update)
- ForwardSyncListener fires async status sync for materialized tasks on terminal transitions, independent of TaskSignalDispatcher
- All operations gracefully degradable: errors logged, never thrown, delegation always proceeds

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement LinearMaterializationAdapter** - `535328b` (feat)
2. **Task 2: Forward status sync listener + barrel exports** - `61bac55` (chore - biome formatting fix; content committed in parallel by 82-04 as `7940823`)

## Files Created/Modified
- `packages/agents/src/shared/services/materialization/linear-adapter.ts` - LinearMaterializationAdapter factory with create/syncStatus/handleWebhook
- `packages/agents/src/shared/services/materialization/forward-sync.ts` - ForwardSyncListener factory for async status propagation
- `packages/agents/src/shared/services/materialization/index.ts` - Updated barrel exports with linear-adapter and forward-sync modules
- `packages/agents/src/shared/services/materialization/types.ts` - Fixed parentIssueId to accept undefined (exactOptionalPropertyTypes)

## Decisions Made
- agent-work label resolved lazily on first create() call and cached for the adapter's lifetime -- avoids upfront API call during adapter construction
- handleWebhook() is synchronous per the MaterializationAdapter interface -- the caller is responsible for looking up the materialization record and passing taskId/conversationId in eventData
- parentIssueId type in MaterializationCreateParams changed from `string` to `string | undefined` to satisfy TypeScript's exactOptionalPropertyTypes -- Plan 04's delegate_task uses spread pattern that produces `string | undefined`
- Team resolution chain: explicit teamId from properties > parent issue's team (via get_issue MCP) > default linearTeamId fallback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed parentIssueId type for exactOptionalPropertyTypes**
- **Found during:** Task 1 (LinearMaterializationAdapter implementation)
- **Issue:** Build failed because Plan 04's delegate_task.ts (already in working tree from parallel execution) uses spread pattern `...(parentIssueId ? { parentIssueId } : {})` which produces `string | undefined`, incompatible with `parentIssueId?: string` under exactOptionalPropertyTypes
- **Fix:** Changed type to `parentIssueId?: string | undefined` in MaterializationCreateParams
- **Files modified:** packages/agents/src/shared/services/materialization/types.ts
- **Verification:** Build compiles cleanly
- **Committed in:** 535328b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type compatibility fix required for parallel plan execution. No scope creep.

## Issues Encountered
- Parallel execution of Plan 04 caused forward-sync.ts and index.ts content to be committed under Plan 04's commit hash (7940823). Plan 03 commit 61bac55 contains only the biome formatting fixes for those files.
- Biome formatter required import sort order fixes and single-line if-throw formatting -- caught by pre-commit hook and fixed before successful commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LinearMaterializationAdapter ready for wiring into delegate_task and delegate_group tools (Plan 04)
- ForwardSyncListener ready for wiring into worker loop / service bootstrap (Plan 05)
- Work correlation registration enables comment routing for materialized issues
- All MCP boundary rules respected (no direct SDK imports)

## Self-Check: PASSED

- All 2 created files verified on disk
- Task 1 commit (535328b) verified in git log
- Task 2 formatting commit (61bac55) verified in git log

---
*Phase: 82-transparent-materialization*
*Completed: 2026-02-20*
