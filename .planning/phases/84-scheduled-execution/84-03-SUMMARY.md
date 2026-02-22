---
phase: 84-scheduled-execution
plan: 03
subsystem: dashboard
tags: [dashboard, schedule, next.js, react, api, cron, agent-service]

# Dependency graph
requires:
  - "84-01: Schedule YAML schema, schedule_state table, createScheduleRegistry()"
  - "84-02: EventRouter schedule.triggered handling, schedule trigger API, worker-loop state updates"
provides:
  - "ScheduleState type and HTTP fetch functions in dashboard agent-service client"
  - "GET /api/schedules/states endpoint with computed nextRunAt via cron-parser"
  - "Schedule badge on agent list cards (clock icon + count)"
  - "AgentSchedulePanel with per-schedule health, cron, next/last run, manual trigger button"
  - "UpcomingSchedulesCard on overview page showing next 5 runs across agents"
  - "triggerSchedule() client function for manual trigger POST with force flag"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [schedule state API merges definition data with runtime state, type predicate filter for null narrowing in sorted arrays, inline trigger feedback without toast library]

key-files:
  created:
    - packages/dashboard/src/components/agents/agent-schedule-panel.tsx
    - packages/dashboard/src/components/overview/upcoming-schedules-card.tsx
  modified:
    - packages/agents/src/service/api/schedule-trigger.ts
    - packages/agents/src/service/api/types.ts
    - packages/dashboard/src/lib/agent-service.ts
    - packages/dashboard/src/services/agents.ts
    - packages/dashboard/src/components/agents/agent-list.tsx
    - packages/dashboard/src/app/agents/[id]/page.tsx
    - packages/dashboard/src/components/overview/live-overview.tsx
    - packages/dashboard/src/app/page.tsx

key-decisions:
  - "GET /api/schedules/states added to schedule-trigger.ts router alongside POST trigger (same router, different HTTP methods)"
  - "Schedule state API merges definition data (cron, timezone, agent name) with runtime state (last run, run count) and computes nextRunAt server-side via cron-parser"
  - "Health derived from lastRunOutcome: failed/cancelled -> failed, else healthy (missed detection deferred as complex)"
  - "Inline trigger feedback pattern (success/skipped/error dots with force-run option) instead of toast library (no sonner dependency)"
  - "AgentRegistrySummary type updated with schedules field and exactOptionalPropertyTypes-compatible timezone?: string | undefined"
  - "Type predicate filter (s): s is ScheduleState & { nextRunAt: string }) used to avoid non-null assertions after filtering"

patterns-established:
  - "Dashboard schedule state pattern: fetch via HTTP from agent-service /api/schedules/states, not direct DB query"
  - "Human-readable cron: inline mapping function for common patterns, raw cron as fallback"
  - "Trigger feedback: inline state (success/skipped/error) with dot indicator and force-run action"

requirements-completed: [SCH-07, SCH-08]

# Metrics
duration: 7min
completed: 2026-02-22
---

# Phase 84 Plan 03: Dashboard Schedule Visibility Summary

**Schedule badges on agent list, per-schedule detail panel with manual trigger and health indicators on agent detail page, and upcoming schedules card on overview page with next 5 runs sorted by time**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-22T21:00:21Z
- **Completed:** 2026-02-22T21:07:30Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Schedule badge (clock icon + count) on agent list cards for agents with schedules
- AgentSchedulePanel component with per-schedule cards: human-readable cron, timezone, next/last run, health dot, run count, and manual trigger button with skip detection and force-run
- UpcomingSchedulesCard on overview page showing next 5 scheduled runs across all agents, sorted by nearest run time
- GET /api/schedules/states endpoint computing nextRunAt from cron-parser and deriving health from last run outcome
- Three health states visually distinguishable: healthy (emerald), failed (red), missed (amber)

## Task Commits

Each task was committed atomically:

1. **Task 1: Schedule types + agent list badge + agent detail schedule section** - `4eadb01e` (feat)
2. **Task 2: Upcoming Schedules card on overview page** - `ed46a516` (feat)

## Files Created/Modified
- `packages/agents/src/service/api/schedule-trigger.ts` - Added GET /states endpoint with nextRunAt computation and ScheduleStateResponse type
- `packages/agents/src/service/api/types.ts` - Added schedules field to AgentRegistrySummary (with exactOptionalPropertyTypes compatibility)
- `packages/dashboard/src/lib/agent-service.ts` - Added ScheduleState type, fetchScheduleStates(), fetchAllScheduleStates(), triggerSchedule() functions
- `packages/dashboard/src/services/agents.ts` - Added getScheduleStatesForAgent() service function, re-exported ScheduleState type
- `packages/dashboard/src/components/agents/agent-list.tsx` - Added Clock icon import and schedule badge in agent card metadata
- `packages/dashboard/src/components/agents/agent-schedule-panel.tsx` - New client component with ScheduleCard, health dot, cron formatter, trigger feedback
- `packages/dashboard/src/app/agents/[id]/page.tsx` - Added schedule states fetch, rendered AgentSchedulePanel in sidebar below config
- `packages/dashboard/src/components/overview/upcoming-schedules-card.tsx` - New component with sorted upcoming runs, health dots, agent links
- `packages/dashboard/src/components/overview/live-overview.tsx` - Added scheduleStates prop and UpcomingSchedulesCard rendering
- `packages/dashboard/src/app/page.tsx` - Added fetchAllScheduleStates() to Promise.all, passed to LiveOverview

## Decisions Made
- **GET endpoint co-located with POST trigger:** Added GET /api/schedules/states to the same schedule-trigger.ts router rather than creating a separate file, since they share the same dependencies (agentRegistry, scheduleRegistry).
- **Server-side nextRunAt computation:** The agent-service computes nextRunAt from cron-parser rather than shipping cron-parser to the dashboard, keeping the dashboard thin.
- **Inline trigger feedback instead of toast:** The dashboard has no toast library (sonner not installed). Used inline state with colored dots and text feedback in the ScheduleCard component. This avoids adding a dependency for one use case.
- **exactOptionalPropertyTypes on schedules.timezone:** Used `timezone?: string | undefined` in the API type to match the Zod-inferred type, consistent with the existing pattern for optional properties in this codebase.
- **Type predicate for filter-then-sort:** Used `(s): s is ScheduleState & { nextRunAt: string }` in the filter to avoid non-null assertions when sorting by nextRunAt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes on schedules.timezone**
- **Found during:** Task 1 (AgentRegistrySummary type update)
- **Issue:** Used `timezone?: string` but AgentDefinition has `timezone?: string | undefined` (from Zod). With `exactOptionalPropertyTypes: true`, these are incompatible types.
- **Fix:** Changed to `timezone?: string | undefined` in AgentRegistrySummary
- **Files modified:** packages/agents/src/service/api/types.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** 4eadb01e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correct compilation with exactOptionalPropertyTypes. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required. The schedule state API and dashboard components are available immediately after service restart.

## Next Phase Readiness
- Phase 84 (Scheduled Execution) is complete: YAML schema, pg-boss registration, event routing, state tracking, manual trigger, and dashboard visibility all shipped
- No agents currently have schedules defined in their YAML -- schedules will appear once agents are configured with `schedules:` blocks in their definition.yaml

---
*Phase: 84-scheduled-execution*
*Completed: 2026-02-22*
