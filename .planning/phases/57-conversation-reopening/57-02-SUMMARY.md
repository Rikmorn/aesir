---
phase: 57-conversation-reopening
plan: 02
subsystem: ui
tags: [next.js, dashboard, dialog, sse, reopen, retry]

# Dependency graph
requires:
  - phase: 57-conversation-reopening/01
    provides: Backend reopen API, schema with reopen_count, agent.reopened event type
provides:
  - Dashboard reopen/retry flow (dialog, API proxy, action bar integration)
  - Dashboard schema mirror with reopen_count and agent.reopened
  - Reopen count visibility in metadata sidebar and conversation list table
  - agent.reopened event icon in timeline
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contextual action labels (Reopen vs Retry) based on conversation status"
    - "SSE optimistic status updates on agent.reopened events"

key-files:
  created:
    - packages/dashboard/src/app/api/conversations/[id]/reopen/route.ts
    - packages/dashboard/src/components/conversation-detail/reopen-dialog.tsx
  modified:
    - packages/dashboard/src/lib/schema.ts
    - packages/dashboard/src/services/conversations.ts
    - packages/dashboard/src/components/conversation-detail/live-detail-panels.tsx
    - packages/dashboard/src/components/conversation-detail/metadata-sidebar.tsx
    - packages/dashboard/src/components/conversation-detail/event-icon.tsx
    - packages/dashboard/src/components/conversations/columns.tsx
    - packages/dashboard/src/components/conversations/live-conversations-table.tsx

key-decisions:
  - "Placed ReopenDialog alongside connection status indicator in a shared flex row (not separate action bar)"
  - "Added queued to SSE isActive check for early connection after reopen"

patterns-established:
  - "API proxy route pattern: POST handler with body validation, upstream fetch, error forwarding"
  - "Contextual button labels: status-driven label text (Retry for failed, Reopen for completed)"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 57 Plan 02: Dashboard Reopen UI Summary

**Reopen/Retry dialog with API proxy route, SSE-aware status updates, metadata sidebar reopen count, and timeline icon for agent.reopened events**

## Performance

- **Duration:** 4m 37s
- **Started:** 2026-02-06T21:21:34Z
- **Completed:** 2026-02-06T21:26:11Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Dashboard schema mirror updated with reopen_count column and agent.reopened event type
- API proxy route forwards reopen requests to agent-service with input validation and error forwarding
- ReopenDialog modal component with contextual labels (Reopen for completed, Retry for failed) and reason textarea
- LiveDetailPanels integrates ReopenDialog in action bar for terminal conversations
- SSE lifecycle handler optimistically updates status to queued on agent.reopened events
- Metadata sidebar shows reopen count with emphasized styling when non-zero
- Event timeline renders agent.reopened with distinct cyan RotateCcw icon
- Conversation list table shows reopen count badge column with tooltip

## Task Commits

Each task was committed atomically:

1. **Task 1: Dashboard schema mirror, conversations service, and API proxy route** - `1a54c8e` (feat)
2. **Task 2: Reopen dialog, action bar, metadata sidebar, event icon, and list columns** - `4e26d6f` (feat)

## Files Created/Modified
- `packages/dashboard/src/app/api/conversations/[id]/reopen/route.ts` - POST proxy route to agent-service reopen endpoint
- `packages/dashboard/src/components/conversation-detail/reopen-dialog.tsx` - Modal dialog with contextual Reopen/Retry labels and reason capture
- `packages/dashboard/src/lib/schema.ts` - Added reopen_count column and agent.reopened event type
- `packages/dashboard/src/services/conversations.ts` - Added reopenCount to detail and list interfaces and queries
- `packages/dashboard/src/components/conversation-detail/live-detail-panels.tsx` - ReopenDialog integration, agent.reopened SSE handler, queued in isActive
- `packages/dashboard/src/components/conversation-detail/metadata-sidebar.tsx` - Reopens metadata field with emphasis on non-zero
- `packages/dashboard/src/components/conversation-detail/event-icon.tsx` - RotateCcw icon with cyan color for agent.reopened
- `packages/dashboard/src/components/conversations/columns.tsx` - Reopen count badge column with RotateCcw icon and tooltip
- `packages/dashboard/src/components/conversations/live-conversations-table.tsx` - Added reopenCount: 0 to SSE-created list items

## Decisions Made
- Placed ReopenDialog in the same flex row as ConnectionStatusIndicator (they are mutually exclusive: connection status shows for active, reopen shows for terminal -- but the shared container avoids layout shift)
- Added `queued` to the SSE `isActive` check so the SSE connection starts early after reopen, catching the agent.started event when the worker picks up the conversation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed live-conversations-table missing reopenCount field**
- **Found during:** Task 1 (schema/service changes)
- **Issue:** `live-conversations-table.tsx` creates ConversationListItem objects from SSE data but was missing the new `reopenCount` field, causing typecheck failure
- **Fix:** Added `reopenCount: 0` to the SSE-created item object
- **Files modified:** `packages/dashboard/src/components/conversations/live-conversations-table.tsx`
- **Verification:** typecheck passes
- **Committed in:** `1a54c8e` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for type safety. No scope creep.

## Issues Encountered
- Biome formatter required auto-formatting on two commits (pre-commit hook caught formatting differences). Resolved with `pnpm run format` before re-committing.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 57 (Conversation Reopening) is complete: backend + dashboard
- Reopen flow is end-to-end: dashboard button -> dialog -> API proxy -> agent-service -> conversation resumes
- No blockers for future phases

## Self-Check: PASSED

---
*Phase: 57-conversation-reopening*
*Completed: 2026-02-06*
