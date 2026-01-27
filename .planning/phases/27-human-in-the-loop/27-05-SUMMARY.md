---
phase: 27-human-in-the-loop
plan: 05
subsystem: agents
tags: [langgraph, re-planning, feedback-loop, slack, llm]

# Dependency graph
requires:
  - phase: 27-01
    provides: DevAgentState with approvalFeedback and approvalStatus fields
provides:
  - Re-planning node for handling plan rejections with feedback
  - Graph routing for rejection -> rePlan flow
  - New "re_planning" phase for workflow state
affects: [27-06, 27-07, dev-agent-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-plan posts revised plan to Slack thread only (not Linear)"
    - "Missing feedback triggers clarification request"
    - "Clear approvalFeedback after revision for next iteration"

key-files:
  created:
    - packages/agents/src/dev-agent/nodes/re-plan.ts
  modified:
    - packages/agents/src/dev-agent/graph.ts
    - packages/agents/src/dev-agent/state.ts
    - packages/agents/src/dev-agent/nodes/index.ts

key-decisions:
  - "Revised plans posted to Slack thread only (Linear gets final approved plan)"
  - "Missing feedback triggers clarification request via Slack"
  - "New 're_planning' phase added to DevAgentPhaseSchema"
  - "Graph ends after rePlan (Temporal handles next signal)"

patterns-established:
  - "Re-plan uses existing research context for continuity"
  - "Feedback cleared after revision to enable iteration"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 27 Plan 05: Re-Plan Node Summary

**LLM-based re-planning node that generates revised plans from rejection feedback, posts to Slack thread, and routes back to approval flow**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T22:50:14Z
- **Completed:** 2026-01-27T22:53:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created createRePlanNode factory with LLM dependency injection
- Added clarification request flow when feedback is missing
- Integrated re-plan node into dev-agent graph with proper routing
- Added "re_planning" phase to state schema for workflow tracking

## Task Commits

Each task was committed atomically:

1. **Task 1: Create re-plan node** - `0d8e089` (feat)
2. **Task 2: Integrate re-plan node into graph** - `a2a8bc0` (feat)

## Files Created/Modified

- `packages/agents/src/dev-agent/nodes/re-plan.ts` - Re-planning node with LLM revision and Slack posting
- `packages/agents/src/dev-agent/nodes/index.ts` - Export createRePlanNode
- `packages/agents/src/dev-agent/graph.ts` - Add rePlan node registration and routing
- `packages/agents/src/dev-agent/state.ts` - Add "re_planning" phase to DevAgentPhaseSchema

## Decisions Made

1. **Revised plans stay in Slack thread only** - Linear gets final approved plan as permanent record. Slack thread enables rapid iteration without cluttering Linear.

2. **Clarification request when feedback missing** - If rejection has no feedback, ask "what would you like me to change?" rather than guessing.

3. **Clear feedback after revision** - Setting approvalFeedback to null allows clean iteration if plan is rejected again.

4. **New "re_planning" phase** - Added to state schema for explicit workflow tracking and routing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed established node patterns from plan.ts and request-approval.ts.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Re-plan node ready for Temporal signal integration (Phase 27-06 or 27-07)
- Temporal workflow needs to set phase to "re_planning" when rejection signal received
- Graph routing tested via typecheck and build verification

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
