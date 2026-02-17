---
phase: 77-dashboard-observability
plan: 01
subsystem: agents
tags: [event-log, sse, mcp, observability, worker-loop]

# Dependency graph
requires:
  - phase: 76-runtime-resilience
    provides: EventLog with getSequence(), recovery context injection pattern
provides:
  - agent.stale_recovered and agent.retry_scheduled event types in schema
  - Event emission at all stale recovery and retry scheduling codepaths
  - MCP onMcpEvent wiring with toolCallId correlation
  - SSE payload expanded with agentInstanceId and parentInstanceId
affects: [77-02 (dashboard schema), 77-03 (timeline rendering), 77-04 (metrics), 77-05 (lifecycle)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onMcpEvent closure pattern: ToolContext.onMcpEvent flows through mcpAdapter to McpToolDeps to callMcpTool"
    - "currentToolCallId mutable tracking: onToolCall sets it, onMcpEvent closure reads it for correlation"

key-files:
  created:
    - packages/agents/src/shared/db/migrations/0013_add_observability_events.sql
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/shared/tools/integration/mcp-wrapper.ts
    - packages/agents/src/shared/mcp/types.ts
    - packages/agents/src/shared/mcp/client.ts
    - packages/agents/src/service/api/sse-events.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/tool-factories.ts

key-decisions:
  - "Migration 0013 needed: CHECK constraint from 0004 must be updated for new event types"
  - "onMcpEvent added to ToolContext (not just McpToolDeps) so mcpAdapter can thread it from worker loop to callMcpTool"
  - "currentToolCallId tracked via closure in worker loop scope -- works because tool calls are sequential within an agent loop iteration"

patterns-established:
  - "ToolContext.onMcpEvent: worker loop sets callback, mcpAdapter passes through, MCP wrapper forwards to callMcpTool"

requirements-completed: [DASH-01, DASH-02, DASH-06]

# Metrics
duration: 7min
completed: 2026-02-17
---

# Phase 77 Plan 01: Agent Event Emission Gaps Summary

**17 event types in agent schema with stale_recovered/retry_scheduled emission, MCP toolCallId correlation, and SSE sub-agent identity fields**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-17T20:46:31Z
- **Completed:** 2026-02-17T20:53:35Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added agent.stale_recovered and agent.retry_scheduled to agentEventTypeValues (now 17 total)
- Emitted both new event types at all relevant codepaths in worker-loop.ts with non-fatal try/catch
- Wired MCP onMcpEvent through ToolContext -> mcpAdapter -> McpToolDeps -> callMcpTool with toolCallId in every event payload
- Expanded SSE buildEventPayload to include agentInstanceId and parentInstanceId for sub-agent attribution

## Task Commits

Each task was committed atomically:

1. **Task 1: Add new event types and emit stale_recovered/retry_scheduled events** - `daca493` (feat)
2. **Task 2: Wire MCP onMcpEvent through tool wrapper with toolCallId and expand SSE payload** - `4e3dbcd` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/schema.ts` - Added agent.stale_recovered and agent.retry_scheduled to agentEventTypeValues
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirrored new event types for drizzle-kit
- `packages/agents/src/shared/db/migrations/0013_add_observability_events.sql` - Migration to update CHECK constraint with all 17 event types
- `packages/agents/src/framework/worker-loop.ts` - Emit stale_recovered at both stale paths, retry_scheduled at both retry paths, onMcpEvent closure, currentToolCallId tracking
- `packages/agents/src/shared/mcp/types.ts` - Added toolCallId to McpCallOptions
- `packages/agents/src/shared/mcp/client.ts` - Added toolCallId to all 5 onMcpEvent payloads
- `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` - Added onMcpEvent and toolCallId to McpToolDeps, passed to callMcpTool
- `packages/agents/src/framework/types.ts` - Added onMcpEvent to ToolContext interface
- `packages/agents/src/framework/tool-factories.ts` - Updated mcpAdapter to pass onMcpEvent from ToolContext to McpToolDeps
- `packages/agents/src/service/api/sse-events.ts` - Expanded buildEventPayload with agentInstanceId and parentInstanceId

## Decisions Made
- **Migration 0013 needed:** Migration 0004 created a CHECK constraint on agent_events.type. Although migration 0012 comments suggest no constraint exists, the constraint from 0004 is real and must be updated for new event types. Created 0013 to safely drop and recreate with all 17 types.
- **onMcpEvent on ToolContext:** Added onMcpEvent to ToolContext (framework types) so the mcpAdapter in tool-factories.ts can forward it to McpToolDeps. This keeps the worker loop as the single wiring point for MCP event observation.
- **currentToolCallId via closure:** Used a mutable `let currentToolCallId` in executeConversation scope, updated by onToolCall, read by onMcpEvent closure. Safe because tool calls are sequential within a single agent loop iteration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created migration 0013 for CHECK constraint update**
- **Found during:** Task 1 (schema changes)
- **Issue:** Plan noted to check for CHECK constraints. Migration 0004 creates agent_events_type_check -- new event types would fail DB insertion without updating it.
- **Fix:** Created 0013_add_observability_events.sql that drops the old constraint and recreates with all 17 event types.
- **Files modified:** packages/agents/src/shared/db/migrations/0013_add_observability_events.sql
- **Verification:** Migration SQL reviewed, follows same pattern as 0004
- **Committed in:** daca493 (Task 1 commit)

**2. [Rule 3 - Blocking] Added onMcpEvent to ToolContext for adapter threading**
- **Found during:** Task 2 (MCP wiring)
- **Issue:** Plan described wiring onMcpEvent through McpToolDeps, but McpToolDeps is created by mcpAdapter from ToolContext. Without onMcpEvent on ToolContext, the adapter has no way to pass it through.
- **Fix:** Added onMcpEvent to ToolContext interface and updated mcpAdapter to forward it.
- **Files modified:** packages/agents/src/framework/types.ts, packages/agents/src/framework/tool-factories.ts
- **Verification:** Typecheck passes, grep confirms onMcpEvent flows through
- **Committed in:** 4e3dbcd (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for the plan's goals. No scope creep -- migration and ToolContext additions are required infrastructure for the specified changes.

## Issues Encountered
- `exactOptionalPropertyTypes` in tsconfig requires explicit undefined-guard when passing optional callback props. Fixed by conditional assignment instead of spread.
- `parentInstanceId` in AppendEventInput typed as `string | null` (not `string | undefined`). Fixed by using null for falsy case.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 17 event types registered in schema, ready for dashboard to consume
- SSE payload includes agentInstanceId and parentInstanceId for Plan 02 dashboard schema
- MCP events include toolCallId for Plan 03 tool card correlation
- Migration 0013 must be run (`pnpm db:migrate`) before deploying

## Self-Check: PASSED

All 10 files verified present. Both task commits (daca493, 4e3dbcd) verified in git log.

---
*Phase: 77-dashboard-observability*
*Completed: 2026-02-17*
