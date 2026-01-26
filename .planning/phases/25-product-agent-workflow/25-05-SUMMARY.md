---
phase: 25-product-agent-workflow
plan: 05
subsystem: agents
tags: [temporal, langgraph, postgresql, checkpointer, mcp, slack]

# Dependency graph
requires:
  - phase: 25-02-confirmation-node
    provides: LangGraph product-agent graph with confirmation flow
  - phase: 19-mcp-layer
    provides: MCP client for integration communication
provides:
  - PostgreSQL checkpointer for conversation history persistence
  - Product-agent Temporal activity wrapping LangGraph
  - Slack reply activity for thread messaging
  - Activity unit tests
affects: [25-06-webhook-router, 25-07-worker-setup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Singleton checkpointer with async initialization
    - Thread ID as checkpointer key for conversation continuity
    - Activity wrapping LangGraph invocation

key-files:
  created:
    - packages/agents/src/product-agent/checkpointer.ts
    - packages/agents/src/temporal/activities/product-agent-activity.ts (in prior session)
    - packages/agents/src/temporal/activities/product-agent-activity.test.ts
  modified:
    - packages/agents/src/product-agent/index.ts
    - packages/agents/src/temporal/activities/slack-activities.ts
    - packages/agents/src/temporal/activities/index.ts
    - packages/agents/src/temporal/types.ts
    - packages/agents/src/temporal/workflows/product-agent-workflow.ts

key-decisions:
  - "Singleton checkpointer pattern avoids multiple DB connections"
  - "Thread timestamp as thread_id enables conversation continuity"
  - "product-agent agentId for MCP permissions tracking"

patterns-established:
  - "Checkpointer factory with setup() call on first use"
  - "Activity extracts response from last AI message"
  - "exactOptionalPropertyTypes: use `string | undefined` for optional return properties"

# Metrics
duration: 10min
completed: 2026-01-26
---

# Phase 25 Plan 05: Temporal Activities Summary

**PostgreSQL checkpointer for conversation persistence with runProductAgentActivity wrapping LangGraph and sendSlackReplyActivity for thread replies**

## Performance

- **Duration:** 10 min
- **Started:** 2026-01-26T00:36:04Z
- **Completed:** 2026-01-26T00:45:47Z
- **Tasks:** 4
- **Files modified:** 8

## Accomplishments

- PostgreSQL checkpointer configured with 'agents' schema for isolation
- runProductAgentActivity invokes LangGraph with thread_id for conversation continuity
- sendSlackReplyActivity uses MCP reply_to_thread for thread-aware messaging
- 10 unit tests verify activity behavior including message extraction

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PostgreSQL checkpointer** - `3b9a3a9` (feat)
2. **Task 2: Create product-agent activity** - Committed in prior session (e968bc3)
3. **Task 3: Add Slack reply activity** - `940c02b` (feat)
4. **Task 4: Add activity tests** - `f6eca31` (test)

## Files Created/Modified

- `packages/agents/src/product-agent/checkpointer.ts` - PostgreSQL checkpointer factory with singleton pattern
- `packages/agents/src/temporal/activities/product-agent-activity.ts` - LangGraph wrapper activity
- `packages/agents/src/temporal/activities/product-agent-activity.test.ts` - 10 unit tests
- `packages/agents/src/temporal/activities/slack-activities.ts` - Added sendSlackReplyActivity
- `packages/agents/src/temporal/activities/index.ts` - Export new activities
- `packages/agents/src/product-agent/index.ts` - Export checkpointer functions
- `packages/agents/src/temporal/types.ts` - Fixed exactOptionalPropertyTypes
- `packages/agents/src/temporal/workflows/product-agent-workflow.ts` - Fixed type assertions

## Decisions Made

1. **Singleton checkpointer pattern** - Avoids creating multiple DB connections, setup() called once on first use
2. **Thread timestamp as thread_id** - Enables natural conversation continuity across workflow iterations
3. **product-agent agentId** - Uses dedicated agentId for MCP permissions tracking instead of temporal-worker
4. **Type assertions for signal state** - TypeScript can't track signal handlers modifying state, use `as unknown as string`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing graph.test.ts type errors**
- **Found during:** Task 1 (checkpointer commit blocked by build)
- **Issue:** Test file had AfterAnalysisRoute type errors with string literals
- **Fix:** Added `as AfterAnalysisRoute` casts and `as const` for arrays
- **Files modified:** packages/agents/src/product-agent/graph.test.ts
- **Committed in:** 3b9a3a9 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes in types.ts**
- **Found during:** Task 2 verification
- **Issue:** Optional properties with `undefined` values need explicit `| undefined`
- **Fix:** Changed `issueId?: string` to `issueId?: string | undefined`
- **Files modified:** packages/agents/src/temporal/types.ts
- **Committed in:** Prior session

**3. [Rule 1 - Bug] Fixed workflow TypeScript control flow issue**
- **Found during:** Task 2 verification
- **Issue:** TypeScript narrowed signal-set state to `never` due to control flow
- **Fix:** Used `as unknown as string` assertion with comment explaining why
- **Files modified:** packages/agents/src/temporal/workflows/product-agent-workflow.ts
- **Committed in:** Prior session

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for type safety and build success. No scope creep.

## Issues Encountered

- Task 2 (product-agent-activity.ts) was partially completed in a prior session and committed with 25-03 docs. Verified it meets requirements and exported correctly.
- Multiple files had `| undefined` missing for exactOptionalPropertyTypes - this project pattern requires explicit undefined in optional return types.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Activities ready for Temporal worker registration
- Checkpointer ready for initialization at worker startup
- Ready for 25-06 (Slack webhook router) and 25-07 (worker setup)

---
*Phase: 25-product-agent-workflow*
*Completed: 2026-01-26*
