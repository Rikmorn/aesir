---
phase: 27-human-in-the-loop
plan: 07
subsystem: agents
tags: [temporal, workflow, approval, slack, linear, cross-channel, timeout, signals]

# Dependency graph
requires:
  - phase: 27-04
    provides: Signal handler for routing approval events to workflows
  - phase: 27-05
    provides: Re-plan node for rejection feedback flow
  - phase: 27-06
    provides: Complete node for workflow finalization
provides:
  - Extended workflow with approval handling and cross-channel sync
  - updateSlackApprovalActivity for Slack message updates
  - syncApprovalToLinearActivity for cross-channel approval sync
  - handleRePlanActivity for rejection re-planning
  - REMINDER_TIMEOUT/FINAL_TIMEOUT constants (24h/72h)
affects: [27-08, 27-09, 27-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-channel sync: Slack approval syncs to Linear comment + status update"
    - "Slack message update: Removes buttons and shows approval status with timestamp"
    - "Re-planning loop: Rejected plan with feedback triggers new plan cycle"

key-files:
  created: []
  modified:
    - packages/agents/src/temporal/signals.ts
    - packages/agents/src/temporal/activities/dev-agent-activities.ts
    - packages/agents/src/temporal/workflows/dev-agent-workflow.ts
    - packages/agents/src/dev-agent/api/signal-handler.ts

key-decisions:
  - "PlanApprovalPayload extended with approverName and source fields"
  - "Cross-channel sync only when approval from Slack (Linear already knows)"
  - "Slack message update removes buttons and shows approver + timestamp"
  - "Rejection with feedback triggers re-planning; without feedback fails gracefully"
  - "REMINDER_TIMEOUT (24h) and FINAL_TIMEOUT (48h) naming for clarity"

patterns-established:
  - "Activity pattern: Non-critical operations fail gracefully (log warning, don't throw)"
  - "Approval flow: Update Slack -> Sync to Linear -> Continue or Re-plan"
  - "Timeout pattern: 24h wait -> stop container + reminder -> 48h more -> end workflow"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 27 Plan 07: Approval Signal Handling with Cross-Channel Sync Summary

**Extended Temporal workflow to handle approval signals with Slack message updates, Linear sync, and re-planning support**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T23:02:19Z
- **Completed:** 2026-01-27T23:06:58Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Extended PlanApprovalPayload signal type with approverName and source fields
- Added three new activities: updateSlackApprovalActivity, syncApprovalToLinearActivity, handleRePlanActivity
- Updated workflow approval handling with cross-channel sync flow
- Implemented rejection with feedback -> re-planning -> new approval cycle
- Renamed timeout constants to REMINDER_TIMEOUT and FINAL_TIMEOUT for clarity

## Task Commits

Each task was committed atomically:

1. **Task 1: Add approval flow activities** - `47924c5` (feat)
   - Extended PlanApprovalPayload with approverName and source
   - Added updateSlackApprovalActivity, syncApprovalToLinearActivity, handleRePlanActivity
   - Updated signal-handler to pass approver info and source

2. **Task 2: Extend workflow with approval handling** - `849b236` (feat)
   - Added slackMessageTs to RunDevAgentGraphOutput
   - Added new activities to proxyActivities
   - Implemented approval handling with Slack update and Linear sync
   - Added rejection with feedback flow triggering re-planning

3. **Task 3: Implement approval timeout with reminder** - `ce51ced` (feat)
   - Renamed APPROVAL_TIMEOUT to REMINDER_TIMEOUT
   - Renamed REMINDER_WAIT to FINAL_TIMEOUT
   - Constants now match plan specification

## Files Modified

- `packages/agents/src/temporal/signals.ts` - Added PlanApprovalPayload interface with approverName and source
- `packages/agents/src/temporal/activities/dev-agent-activities.ts` - Added 3 new activities and slackMessageTs to output types
- `packages/agents/src/temporal/workflows/dev-agent-workflow.ts` - Extended approval handling with cross-channel sync
- `packages/agents/src/dev-agent/api/signal-handler.ts` - Extended ApprovalSignalInput with approverName and source

## Decisions Made

1. **PlanApprovalPayload extension:** Signal payload now includes optional approverName and source fields. Source indicates whether approval came from "slack" or "linear" for cross-channel sync logic.

2. **Cross-channel sync direction:** Only sync when approval comes from Slack (add Linear comment + update status). When approval comes from Linear, skip sync (Linear already has the info).

3. **Slack message update format:** Shows "Plan Approved :white_check_mark: / Approved by {name} at {time} / Executing... Estimated time: ~5-10 min" - removes buttons by providing new blocks.

4. **Re-planning flow:** Rejection with feedback triggers handleRePlanActivity which runs graph from re_planning phase. New plan posts to Slack thread, workflow waits for next approval. One re-plan cycle supported.

5. **Timeout constant naming:** REMINDER_TIMEOUT (24h) and FINAL_TIMEOUT (48h) names match plan specification and clarify purpose.

## Deviations from Plan

None - plan executed exactly as written. The timeout logic was already implemented in the existing workflow; Task 3 renamed constants for consistency with plan specification.

## Issues Encountered

None - all tasks completed successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Approval signal handling complete with cross-channel sync
- Slack message updates working with approval status
- Re-planning flow implemented for rejection with feedback
- Timeout logic with REMINDER_TIMEOUT/FINAL_TIMEOUT ready
- Next plans can build on this for PR feedback and completion flows

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
