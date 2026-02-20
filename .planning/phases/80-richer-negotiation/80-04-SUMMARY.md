---
phase: 80-richer-negotiation
plan: 04
subsystem: dashboard
tags: [dashboard, timeline, negotiation, counter-propose, clarification, status-badge]

# Dependency graph
requires:
  - phase: 80-richer-negotiation/01
    provides: counter_proposed task status, task_counter_proposed signal type
  - phase: 80-richer-negotiation/02
    provides: task:clarify and task:answer tools, task_clarification and task_clarification_response signal types
provides:
  - Dashboard timeline rendering for counter-proposal and clarification events
  - counter_proposed status recognition in StatusBadge and task detail panel
  - DELEGATION_TOOL_NAMES includes clarify and answer tools (both namespace and internal formats)
  - Fixed tool_name property access (snake_case) in timeline filter, event row, and graph-utils
affects: [dashboard, observability]

# Tech tracking
tech-stack:
  added: []
  patterns: [normalize-tool-names, dual-property-fallback]

key-files:
  created: []
  modified:
    - packages/dashboard/src/lib/schema.ts
    - packages/dashboard/src/services/tasks.ts
    - packages/dashboard/src/components/tasks/timeline-event-row.tsx
    - packages/dashboard/src/components/tasks/task-detail-panel.tsx
    - packages/dashboard/src/components/conversations/status-badge.tsx
    - packages/dashboard/src/components/tasks/graph-utils.ts

key-decisions:
  - "Both namespace (task:clarify) and internal (clarify_task) tool name formats in DELEGATION_TOOL_NAMES for robustness"
  - "Normalize internal tool names to namespace format in timeline-event-row via lookup table"
  - "Fixed pre-existing tool_name property access bug (JSONB stores snake_case, code read camelCase)"
  - "Counter-proposed uses amber accent (same as waiting/paused) per design system status colors"

patterns-established:
  - "Dual property fallback: read tool_name with toolName fallback for forward/backward compat"
  - "Tool name normalization: internal names mapped to namespace format in rendering layer"

requirements-completed: [NEG-01, NEG-03, NEG-04, NEG-05]

# Metrics
duration: 6min
completed: 2026-02-20
---

# Phase 80 Plan 04: Dashboard Negotiation Timeline Summary

**Dashboard timeline rendering for counter-proposals and clarifications with amber/blue accents, counter_proposed status badge, and fixed tool_name property access for event filtering**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T19:03:45Z
- **Completed:** 2026-02-20T19:10:05Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added counter_proposed to dashboard schema taskStatusValues and StatusBadge (amber accent)
- Extended DELEGATION_TOOL_NAMES with task:clarify and task:answer (both namespace and internal formats)
- Rendered counter-proposal events with amber accent, clarification events with blue accent in timeline
- Enhanced signal rendering for task_counter_proposed, task_clarification, task_clarification_response
- Fixed pre-existing tool_name property access bug that prevented all tool events from showing in timeline
- Updated task-detail-panel handshake section for counter-proposed status with proposal text display

## Task Commits

Each task was committed atomically:

1. **Task 1: Update dashboard schema and delegation tool names** - `c19261c` (feat)
2. **Task 2: Render counter-proposal and clarification events in timeline** - `deea4eb` (feat)

## Files Created/Modified
- `packages/dashboard/src/lib/schema.ts` - Added counter_proposed to taskStatusValues
- `packages/dashboard/src/services/tasks.ts` - Extended DELEGATION_TOOL_NAMES, fixed tool_name property access
- `packages/dashboard/src/components/tasks/timeline-event-row.tsx` - Rewrote with negotiation event rendering and tool name normalization
- `packages/dashboard/src/components/tasks/task-detail-panel.tsx` - Counter-proposed handshake, enhanced signal labels
- `packages/dashboard/src/components/conversations/status-badge.tsx` - Added counter_proposed status config
- `packages/dashboard/src/components/tasks/graph-utils.ts` - Fixed tool_name property access for delegation edges

## Decisions Made
- Included both namespace format (task:clarify) and internal format (clarify_task) in DELEGATION_TOOL_NAMES. The event payload stores the internal LLM tool name, but the dashboard historically referenced namespace format. Including both ensures events are captured regardless of which format appears.
- Added a `getToolName()` helper in timeline-event-row.tsx that normalizes internal names (respond_task, clarify_task) to namespace format (task:respond, task:clarify) for consistent matching throughout rendering logic.
- Used amber for counter_proposed status badge (matches waiting/paused in the design system's status color scheme -- negotiation in progress is a waiting-like state).
- Used blue for clarification events (informational, question-answer flow -- matches the design system's info/signal color).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed tool_name property access throughout task timeline**
- **Found during:** Task 1 (investigating DELEGATION_TOOL_NAMES format)
- **Issue:** Event payload stores `tool_name` (snake_case from event log), but tasks.ts filter read `toolName` (camelCase), causing ALL tool events to be filtered out of the timeline. Same issue in timeline-event-row.tsx, task-detail-panel.tsx, and graph-utils.ts.
- **Fix:** Added dual property fallback (`tool_name ?? toolName`) in tasks.ts filter; created getToolName/getToolInput helpers in timeline-event-row.tsx with normalization; fixed handshake detection in task-detail-panel.tsx; fixed delegation edge detection in graph-utils.ts.
- **Files modified:** packages/dashboard/src/services/tasks.ts, packages/dashboard/src/components/tasks/timeline-event-row.tsx, packages/dashboard/src/components/tasks/task-detail-panel.tsx, packages/dashboard/src/components/tasks/graph-utils.ts
- **Verification:** Dashboard builds successfully
- **Committed in:** c19261c (Task 1) and deea4eb (Task 2)

**2. [Rule 1 - Bug] Fixed arguments property access in timeline-event-row.tsx**
- **Found during:** Task 2 (rendering tool event descriptions)
- **Issue:** Code read `payload?.arguments` but event payload stores `input` (from event log). Tool input was always undefined.
- **Fix:** Created getToolInput() helper that reads `input` with `arguments` fallback.
- **Files modified:** packages/dashboard/src/components/tasks/timeline-event-row.tsx
- **Verification:** Dashboard builds successfully
- **Committed in:** deea4eb (Task 2)

**3. [Rule 2 - Missing Critical] Added counter_proposed to StatusBadge**
- **Found during:** Task 2 (rendering counter_proposed status in task detail panel)
- **Issue:** StatusBadge component had no config for counter_proposed -- would fall back to raw text display with no styling.
- **Fix:** Added counter_proposed entry with amber dot and background, label "Counter-Proposed"
- **Files modified:** packages/dashboard/src/components/conversations/status-badge.tsx
- **Verification:** Dashboard builds successfully
- **Committed in:** deea4eb (Task 2)

**4. [Rule 1 - Bug] Fixed graph-utils.ts delegation edge tool name matching**
- **Found during:** Task 2 (investigating all toolName references)
- **Issue:** graph-utils.ts read `toolName` (camelCase) for delegation edge detection, same bug as timeline.
- **Fix:** Switched to dual property fallback matching both internal and namespace formats.
- **Files modified:** packages/dashboard/src/components/tasks/graph-utils.ts
- **Verification:** Dashboard builds successfully
- **Committed in:** deea4eb (Task 2)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 missing critical)
**Impact on plan:** Bug fixes were necessary to make the timeline feature functional -- without them, no tool events would appear in the timeline at all. The StatusBadge addition is essential for counter_proposed visibility. All fixes are directly related to the plan's objective.

## Issues Encountered
- Pre-commit hooks ran typecheck across all packages (biome + tsc) -- both passes completed successfully.

## Deferred Items
- The `tool_name` vs `toolName` discrepancy is systemic. The event log stores snake_case but some dashboard code reads camelCase. A comprehensive audit of all payload property access would be valuable but is out of scope for this plan. The dual-fallback pattern applied here handles both cases.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 80 (Richer Negotiation) is complete -- all 4 plans shipped
- Dashboard displays negotiation events with distinct visual treatment
- Counter-proposals, clarifications, and answers are visible in the task timeline
- counter_proposed status is recognized throughout the dashboard

---
*Phase: 80-richer-negotiation*
*Completed: 2026-02-20*
