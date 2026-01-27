---
phase: 27-human-in-the-loop
plan: 06
subsystem: agents
tags: [langgraph, node, slack, linear, container-cleanup, mcp, block-kit]

# Dependency graph
requires:
  - phase: 27-01
    provides: MCP client integration for agent-integration communication
  - phase: 26
    provides: Dev-agent graph structure and state definition
provides:
  - Complete node for workflow finalization after PR merge
  - Linear status update to "Done" on task completion
  - Slack completion notification with summary stats
  - Container cleanup integration
affects: [27-07, 27-08, 27-09, 27-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Node factory pattern with DI for cleanup service
    - Non-critical operations fail gracefully (Linear update, Slack notification, cleanup)
    - Block Kit formatting for rich Slack notifications

key-files:
  created:
    - packages/agents/src/dev-agent/nodes/complete.ts
  modified:
    - packages/agents/src/dev-agent/nodes/index.ts
    - packages/agents/src/dev-agent/graph.ts
    - packages/agents/src/temporal/activities/dev-agent-activities.ts
    - packages/agents/src/dev-agent/worker.ts

key-decisions:
  - "DevContainerCleanup instead of DevContainerManager for cleanup operations"
  - "Complete node added to graph but existing 'complete' phase routing unchanged"
  - "Cleanup dependency added to graph options, activities deps, and worker"

patterns-established:
  - "Complete node pattern: Linear update + Slack notification + container cleanup"
  - "Graceful failure for non-critical operations in finalization"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 27 Plan 06: Complete Node Summary

**Task completion node with Linear Done status, Slack completion notification with Block Kit stats, and container cleanup via DevContainerCleanup service**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T22:55:23Z
- **Completed:** 2026-01-27T22:59:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created complete node that finalizes workflow after PR merge
- Updates Linear issue status to "Done" via MCP callMcpTool
- Sends completion notification to main Slack channel with Block Kit formatting
- Includes summary stats (files changed, execution steps)
- Cleans up dev container via DevContainerCleanup service
- Integrated node into dev-agent graph with proper routing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create complete node** - `9a112bc` (feat)
2. **Task 2: Integrate complete node into graph** - `fc2b466` (feat)

## Files Created/Modified

- `packages/agents/src/dev-agent/nodes/complete.ts` - Complete node with createCompleteNode factory
- `packages/agents/src/dev-agent/nodes/index.ts` - Export createCompleteNode and CompleteNodeDeps
- `packages/agents/src/dev-agent/graph.ts` - Add complete node and DevContainerCleanup dependency
- `packages/agents/src/temporal/activities/dev-agent-activities.ts` - Add cleanup to activities deps
- `packages/agents/src/dev-agent/worker.ts` - Create cleanup service and pass to activities

## Decisions Made

1. **DevContainerCleanup vs DevContainerManager:** Used DevContainerCleanup service for cleanup operations since it has the `cleanupContainer(taskId)` method. DevContainerManager handles spawning and execution, not cleanup.

2. **Graph routing unchanged:** Kept existing `case "complete": return "notify"` routing. The complete node is added to the graph and can be invoked from receiveIssue routing, but the existing PR creation flow (which sets phase to "complete") still routes to notify. This preserves backward compatibility.

3. **Graceful failure pattern:** All operations in complete node (Linear update, Slack notification, container cleanup) are non-critical and fail gracefully with logged warnings, ensuring workflow completes even if external services fail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added cleanup dependency to activities and worker**
- **Found during:** Task 2 (Integrate complete node into graph)
- **Issue:** TypeScript build failed - DevAgentActivitiesDeps and graph options required cleanup dependency
- **Fix:** Added DevContainerCleanup to activities interface, graph options, and worker initialization
- **Files modified:** dev-agent-activities.ts, graph.ts, worker.ts
- **Verification:** pnpm --filter @aesir/agents build passes
- **Committed in:** fc2b466 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary cascading change for TypeScript type safety. No scope creep.

## Issues Encountered

None - plan executed with expected dependency propagation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Complete node ready for Temporal activity invocation after PR merge signal
- Graph structure supports direct invocation via receiveIssue routing
- Next plans can wire up the Temporal signal handling for completion flow

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
