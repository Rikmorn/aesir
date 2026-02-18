---
phase: 74-quick-fixes
plan: 03
subsystem: agents
tags: [prompt-engineering, communication, dev-agent]

# Dependency graph
requires:
  - phase: 73-qa-validation
    provides: "Agent collaboration framework with communication tools (reply, ask, notify)"
provides:
  - "Dev-agent prompt with judgment criteria for ask vs reply communication"
  - "Channel-aware communication guidance (Linear/Slack/notify cost model)"
affects: [agent-behavior, dev-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel-cost communication model: match communication frequency to channel attention cost"
    - "State-assumptions-and-go default: agents communicate intent and start, users course-correct"

key-files:
  created: []
  modified:
    - packages/agents/definitions/dev-agent/prompt.md

key-decisions:
  - "Default mode is state-assumptions-and-go, not ask-first"
  - "Genuine ambiguity is the bar for blocking with ask+wait_for"
  - "Channel-aware communication: Linear=trail, Slack=outcomes, notify=broadcasts"

patterns-established:
  - "Communication judgment criteria in prompts: teach when to pause, not prescribe tool sequences"

requirements-completed: [QF-02]

# Metrics
duration: 2min
completed: 2026-02-16
---

# Phase 74 Plan 03: Dev-Agent Communication Judgment Summary

**Dev-agent prompt rewritten with "state assumptions and go" default, genuine-ambiguity bar for ask+wait_for, and channel-cost communication model**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T21:59:53Z
- **Completed:** 2026-02-16T22:01:42Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Rewrote "Working with Humans" section with judgment criteria for ask vs reply (not a state machine)
- Established "state assumptions and go" as the default operating mode
- Added channel-aware communication guidance distinguishing Linear (progress trail), Slack/reply (outcomes only), and notify (channel-relevant outcomes only)
- Updated "Communication on Linear" section to align with channel-cost principles
- Preserved all mechanical tool descriptions (replyContext handling) and completion behavior unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite dev-agent "Working with Humans" section with judgment criteria** - `f1c6643` (feat)

## Files Created/Modified
- `packages/agents/definitions/dev-agent/prompt.md` - Dev-agent system prompt with expanded communication judgment criteria and channel-aware guidance

## Decisions Made
- Default mode is "state assumptions and go" -- agent communicates what it's doing and starts working, user can course-correct
- Blocking (ask + wait_for) reserved for genuine ambiguity the agent cannot infer from context or codebase
- Delegation context = low interactivity (requirements already clarified); direct trigger = medium interactivity
- Channel cost model: Linear updates freely (low-cost audit trail), Slack/reply limited to outcomes and blockers, notify limited to channel-relevant outcomes
- Bundle all unknowns into a single ask + wait_for to minimize user context switches

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dev-agent prompt ready for behavioral testing in agent integration tests
- QF-02 requirement satisfied: agent has judgment criteria for ask vs reply

## Self-Check: PASSED

- FOUND: packages/agents/definitions/dev-agent/prompt.md
- FOUND: .planning/phases/74-quick-fixes/74-03-SUMMARY.md
- FOUND: f1c6643 (Task 1 commit)

---
*Phase: 74-quick-fixes*
*Completed: 2026-02-16*
