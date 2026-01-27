---
phase: 27-human-in-the-loop
plan: 08
subsystem: agents
tags: [temporal, signals, workflow, completion, pr-merge, container-cleanup]

# Dependency graph
requires:
  - phase: 27-04
    provides: Signal handler module for Temporal workflow communication
  - phase: 27-06
    provides: Complete node for Linear/Slack/cleanup operations
provides:
  - prCompletionSignal for PR merge/close events
  - completeTaskActivity for task completion after PR merge
  - handlePRClosedActivity for PR cancellation handling
  - Extended workflow waiting for PR completion before ending
affects: [27-09, 27-10, 27-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Signal-driven completion flow
    - Type assertion for signal-based state mutation

key-files:
  created: []
  modified:
    - packages/agents/src/temporal/signals.ts
    - packages/agents/src/temporal/workflows/dev-agent-workflow.ts
    - packages/agents/src/temporal/activities/dev-agent-activities.ts

key-decisions:
  - "prCompletionSignal payload includes merged boolean and prNumber"
  - "Type assertion needed for state.prCompletion after wf.condition due to TypeScript flow analysis"
  - "Spread operator pattern for optional containerId to satisfy exactOptionalPropertyTypes"
  - "Feedback loop after PR review: wait for next signal (completion or more feedback)"

patterns-established:
  - "Completion signal triggers Linear Done + Slack notification + container cleanup"
  - "PR closed without merge triggers Slack notification + cleanup but returns failure"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 27 Plan 08: PR Completion Signal Handling Summary

**Extended Temporal workflow to handle PR merge/close events for task completion with Linear status update, Slack notification, and container cleanup**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T23:09:15Z
- **Completed:** 2026-01-27T23:13:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added prCompletionSignal definition with PRCompletionPayload type
- Added completeTaskActivity for PR merge completion flow
- Added handlePRClosedActivity for PR cancellation handling
- Extended workflow to wait for PR completion after PR creation
- PR merge triggers full completion: Linear Done status, Slack notification, container cleanup
- PR closed without merge notifies Slack and cleans up container
- Handle iterative feedback loop: after addressing review, continue waiting for completion

## Task Commits

Each task was committed atomically:

1. **Task 1: Add completion activities** - `8f2d448` (feat)
2. **Task 2: Add PR completion signal to workflow** - `7ae0b45` (feat)

## Files Created/Modified

- `packages/agents/src/temporal/signals.ts` - Added prCompletionSignal and PRCompletionPayload
- `packages/agents/src/temporal/activities/dev-agent-activities.ts` - Added completeTaskActivity and handlePRClosedActivity
- `packages/agents/src/temporal/workflows/dev-agent-workflow.ts` - Extended with prCompletion state, signal handler, and completion flow

## Decisions Made

1. **PRCompletionPayload structure:** Simple payload with `merged: boolean` and `prNumber: number`. The merged flag distinguishes merge (completion) from close (cancellation).

2. **Type assertion for signal state:** TypeScript's flow analysis doesn't understand that `state.prCompletion` can change due to signal handlers after `wf.condition`. Used explicit type assertion `as PRCompletionPayload | null` to help the compiler.

3. **Spread operator for containerId:** Used `...(containerIdParam !== undefined ? { containerId: containerIdParam } : {})` pattern to satisfy exactOptionalPropertyTypes when containerId is `string | undefined`.

4. **Feedback loop continuation:** After handling PR feedback, the workflow continues waiting for either another feedback signal or the completion signal. This supports iterative review cycles.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - plan executed cleanly with expected TypeScript patterns.

## User Setup Required

None - no external service configuration required. The completion activities use existing MCP tools and DevContainerCleanup service.

## Next Phase Readiness

- Workflow now waits for PR completion signal before ending
- sendCompletionSignal in signal-handler.ts needs to be updated to actually send the prCompletionSignal (plan 27-09 or similar)
- Event handler routes GitHub PR merge/close events to signal handler

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
