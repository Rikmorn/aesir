---
phase: 27-human-in-the-loop
plan: 04
subsystem: agents
tags: [temporal, signals, slack, github, linear, events, approval, llm]

# Dependency graph
requires:
  - phase: 27-01
    provides: classifyApprovalIntent for LLM-based approval classification
  - phase: 27-13
    provides: Linear comment webhook dispatcher for comment.created events
  - phase: 26
    provides: Dev-agent workflow with planApprovalSignal handler
provides:
  - sendApprovalSignal function for sending plan approval/rejection to workflows
  - sendCompletionSignal function for handling PR merge/close events
  - Extended event handler supporting Slack, GitHub, and Linear events
affects: [27-05, 27-06, 27-07, 27-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Signal handler module for Temporal workflow communication
    - Multi-source event routing in dev-agent

key-files:
  created:
    - packages/agents/src/dev-agent/api/signal-handler.ts
  modified:
    - packages/agents/src/dev-agent/api/events.ts
    - packages/agents/src/dev-agent/api/index.ts

key-decisions:
  - "Workflow ID derived from taskId when available, falling back to taskIdentifier"
  - "LLM is optional dep in event handler - only needed for Linear comment classification"
  - "Spread operator pattern for optional properties to satisfy exactOptionalPropertyTypes"
  - "Completion signal extracts task identifier from feature/ABC-123 branch naming"

patterns-established:
  - "SignalHandlerDeps: inject workflowClient + logger for signal operations"
  - "Event handler routes by source + type prefix for multi-integration support"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 27 Plan 04: Dev-Agent Event Signal Handler Summary

**Extended dev-agent to receive Slack/GitHub/Linear events and signal Temporal workflows for approval and completion flows**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T22:45:17Z
- **Completed:** 2026-01-27T22:48:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created signal handler module for Temporal workflow communication
- Extended event handler to process Slack block_actions approval/rejection clicks
- Extended event handler to process GitHub PR merged/closed events
- Extended event handler to process Linear comment events with LLM classification
- Graceful handling of workflow-not-found errors (does not throw)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create signal handler module** - `50c9020` (feat)
2. **Task 2: Extend dev-agent event handler** - `068253c` (feat)

## Files Created/Modified

- `packages/agents/src/dev-agent/api/signal-handler.ts` - Signal sending logic for Temporal workflows (sendApprovalSignal, sendCompletionSignal)
- `packages/agents/src/dev-agent/api/events.ts` - Extended event handler for Slack/GitHub/Linear events
- `packages/agents/src/dev-agent/api/index.ts` - Barrel export updated with signal handler exports

## Decisions Made

- **Workflow ID derivation:** When sending approval signals, use taskId (UUID) if available, otherwise fall back to taskIdentifier (e.g., ABC-123). This handles both cases where we know the exact workflow ID and cases where we only have the human-readable identifier.

- **Optional LLM dependency:** The LLM for Linear comment classification is an optional dependency. If not provided, Linear comment events are acknowledged but not processed for approval classification. This allows the event handler to run without LLM for simpler use cases.

- **Completion signal logging only:** sendCompletionSignal currently just logs the PR completion and extracts task identifier from branch name. Actual completion flow will be implemented in plan 06.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes type error**
- **Found during:** Task 1 (Signal handler module)
- **Issue:** Passing `feedback: string | undefined` to signal payload failed with exactOptionalPropertyTypes
- **Fix:** Build payload object conditionally, only adding feedback property when defined
- **Files modified:** packages/agents/src/dev-agent/api/signal-handler.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** 50c9020 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed same exactOptionalPropertyTypes error in events.ts**
- **Found during:** Task 2 (Event handler extension)
- **Issue:** Same issue when passing feedback to sendApprovalSignal
- **Fix:** Used spread operator pattern `...(condition ? { feedback: value } : {})`
- **Files modified:** packages/agents/src/dev-agent/api/events.ts
- **Verification:** pnpm --filter @aesir/agents build passes
- **Committed in:** 068253c (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs - TypeScript strictness)
**Impact on plan:** Both fixes required for TypeScript compilation with project settings. No scope creep.

## Issues Encountered

None - plan executed with minor type fixes as described above.

## User Setup Required

None - no external service configuration required. The LLM for Linear comment classification requires ANTHROPIC_API_KEY which is already configured for the dev-agent.

## Next Phase Readiness

- Signal handler ready for use by other plans (27-05, 27-06, 27-07)
- Event handler ready to receive dispatched events from integration webhooks
- Missing: main.ts needs to be updated to pass LLM to event handler deps for Linear comment classification (can be done when needed)

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
