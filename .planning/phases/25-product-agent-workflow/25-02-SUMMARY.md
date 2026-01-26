---
phase: 25-product-agent-workflow
plan: 02
subsystem: agents
tags: [langgraph, llm, structured-output, zod, slack, confirmation-pattern]

# Dependency graph
requires:
  - phase: 25-product-agent-workflow
    provides: Research on confirmation-before-action pattern and existing product-agent state
provides:
  - IssueDraftSchema for structured issue previews
  - confirmNode for generating draft previews
  - awaitingConfirmation state flag for workflow routing
  - Slack-formatted preview messages with confirmation instruction
affects: [25-03, 25-04, 25-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confirmation-before-action: Show draft preview before creating external resources"
    - "Slack-markdown formatting for preview messages with *bold* syntax"
    - "awaitingConfirmation flag for workflow state machine routing"

key-files:
  created:
    - packages/agents/src/product-agent/nodes/confirm.ts
    - packages/agents/src/product-agent/nodes/confirm.test.ts
  modified:
    - packages/agents/src/product-agent/state.ts
    - packages/agents/src/product-agent/prompts.ts
    - packages/agents/src/product-agent/nodes/index.ts
    - packages/agents/src/product-agent/graph.test.ts

key-decisions:
  - "IssueDraft includes slackThreadUrl for linking back to conversation"
  - "Preview message uses Slack markdown with *bold* formatting"
  - "Error handling falls back to gathering phase, not failure"

patterns-established:
  - "Confirmation node pattern: generate draft with structured output, format preview, return with awaitingConfirmation flag"
  - "Slack preview format with checkboxes for acceptance criteria"

# Metrics
duration: 5min
completed: 2026-01-26
---

# Phase 25 Plan 02: Create Confirmation Node Summary

**Issue draft confirmation node with Slack-formatted preview and awaitingConfirmation state flag**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-26T00:26:21Z
- **Completed:** 2026-01-26T00:32:20Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- IssueDraftSchema with title, description, acceptanceCriteria, priority, labels, slackThreadUrl
- confirmNode that generates issue draft using LLM structured output
- Slack-formatted preview message with confirmation instruction
- 21 unit tests covering draft generation and formatting

## Task Commits

Each task was committed atomically:

1. **Task 1: Update state for confirmation flow** - `1901b4e` (feat)
2. **Task 2: Create confirmation node with draft generation** - `cbf2126` (feat)
3. **Task 3: Add unit tests for confirmation node** - `73c619e` (test)

## Files Created/Modified

- `packages/agents/src/product-agent/state.ts` - Added IssueDraftSchema, IssuePrioritySchema, issueDraft and awaitingConfirmation state fields
- `packages/agents/src/product-agent/nodes/confirm.ts` - Confirmation node that generates issue draft preview
- `packages/agents/src/product-agent/nodes/confirm.test.ts` - 21 unit tests for confirmation node
- `packages/agents/src/product-agent/prompts.ts` - Added GENERATE_ISSUE_DRAFT_PROMPT
- `packages/agents/src/product-agent/nodes/index.ts` - Export confirmNode and types
- `packages/agents/src/product-agent/graph.test.ts` - Updated test state with new fields

## Decisions Made

- **slackThreadUrl in draft:** Include link back to Slack conversation for context when viewing issue in Linear
- **Slack markdown format:** Use *bold* syntax for labels, checkboxes for acceptance criteria (Slack native format)
- **Error fallback:** On LLM error, fall back to gathering phase instead of failing (allows retry)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-commit hook lint failures required sorting imports and using correct type import syntax
- graph.test.ts needed update to include new state fields (issueDraft, awaitingConfirmation)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- confirmNode ready to be wired into graph routing
- awaitingConfirmation flag available for workflow conditional edges
- Plan 03 can implement response handling for "confirm" vs feedback

---
*Phase: 25-product-agent-workflow*
*Completed: 2026-01-26*
