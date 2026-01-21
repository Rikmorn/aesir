---
phase: 14-platform-services
plan: 05
subsystem: database
tags: [cleanup, retention, langgraph, postgresql, batch-delete]

# Dependency graph
requires:
  - phase: 14-03
    provides: webhookDeliveries table schema for cleanup
  - phase: 14-04
    provides: agentExecutions table schema for cleanup
provides:
  - Cleanup service for retention-based deletion
  - Batch deletion for webhook deliveries
  - Batch deletion for agent executions (protecting in-progress)
  - LangGraph checkpoint cleanup
  - CLI script for manual cleanup trigger
affects: [15-operations, observability, maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Factory pattern for service creation (createCleanupService)
    - Batch deletion with LIMIT to avoid long transactions
    - Dry-run mode for preview without execution

key-files:
  created:
    - packages/platform/src/services/cleanup.ts
    - packages/platform/src/services/index.ts
    - packages/platform/src/scripts/run-cleanup.ts
  modified:
    - packages/platform/src/index.ts
    - packages/platform/package.json

key-decisions:
  - "Raw pg Pool for cross-schema queries (integrations.*, observability.*, public.*)"
  - "Thread ID pattern: approval-{issue_id} derived from existing codebase"
  - "Delete order for checkpoints: writes -> blobs -> checkpoints (dependency order)"

patterns-established:
  - "CLI scripts in src/scripts/ directory with --flag pattern"
  - "Cleanup dry-run mode counts without deleting"

# Metrics
duration: 4min
completed: 2026-01-21
---

# Phase 14 Plan 05: Cleanup Service Summary

**Cleanup service with batch deletion for webhook deliveries, agent executions (protecting in-progress), and LangGraph checkpoints via CLI trigger**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-21T10:33:48Z
- **Completed:** 2026-01-21T10:37:02Z
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- Factory-pattern cleanup service with configurable retention and batch size
- Webhook deliveries cleanup with batch DELETE using LIMIT
- Agent executions cleanup protecting status='started' records
- LangGraph checkpoint cleanup for completed threads
- Dry-run mode for previewing deletions
- CLI script with npm run cleanup and npm run cleanup:dry-run

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cleanup service - core structure** - `6e8cbcf` (feat)
2. **Task 2: Add LangGraph checkpoint cleanup** - `970dd64` (feat)
3. **Task 3: Create cleanup CLI script and exports** - `3992324` (feat)

## Files Created/Modified

- `packages/platform/src/services/cleanup.ts` - Cleanup service with batch deletion (363 lines)
- `packages/platform/src/services/index.ts` - Services barrel export
- `packages/platform/src/scripts/run-cleanup.ts` - CLI script for manual trigger
- `packages/platform/src/index.ts` - Added services export
- `packages/platform/package.json` - Added cleanup scripts

## Decisions Made

1. **Raw pg Pool for cross-schema queries** - Used raw pg Pool instead of Drizzle ORM because cleanup needs to query across multiple schemas (integrations, observability, public) in single queries

2. **Thread ID pattern from executions** - LangGraph checkpoints don't have timestamps, so we use agent_executions as proxy. Thread IDs derived using existing pattern: `approval-{issue_id}`

3. **Delete order for checkpoints** - Deletes in logical dependency order: checkpoint_writes -> checkpoint_blobs -> checkpoints

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cleanup service ready for manual trigger via `npm run cleanup`
- Scheduled execution (Temporal workflow or cron) deferred to Phase 15
- Service exported from @aesir/platform for use by other components

---
*Phase: 14-platform-services*
*Completed: 2026-01-21*
