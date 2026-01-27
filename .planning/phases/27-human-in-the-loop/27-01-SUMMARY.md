---
phase: 27-human-in-the-loop
plan: 01
subsystem: agents
tags: [langchain, anthropic, zod, classification, approval, natural-language]

# Dependency graph
requires:
  - phase: 26-dev-agent-workflow
    provides: dev-agent graph reaching awaiting_approval state
provides:
  - LLM-based approval intent classification for human responses
  - ApprovalClassificationSchema with intent/confidence/feedback/reasoning
  - classifyApprovalIntent function using ChatAnthropic.withStructuredOutput
affects: [27-02, 27-03, 27-04, 27-05, slack-approval-handler, linear-comment-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [structured-output-classification, approval-intent-detection]

key-files:
  created:
    - packages/agents/src/dev-agent/classification/approval.ts
    - packages/agents/src/dev-agent/classification/approval.test.ts
  modified: []

key-decisions:
  - "Flat Zod schema for reliable LLM structured output (following product-agent pattern)"
  - "Four intent types: approve, reject, unclear, question"
  - "Three confidence levels: high, medium, low"
  - "Empty messages handled before LLM call (return unclear/high)"
  - "Long messages truncated to 4000 chars to avoid context limits"
  - "LLM errors return unclear/low (safe fallback)"

patterns-established:
  - "Approval classification: use classifyApprovalIntent for natural language approval detection"
  - "Rejection feedback extraction: feedback field populated when intent=reject"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 27 Plan 01: Approval Classification Summary

**LLM-based approval intent classification using ChatAnthropic.withStructuredOutput for natural language approval/rejection detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T22:26:24Z
- **Completed:** 2026-01-27T22:29:05Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created approval classification module with Zod schema for intent/confidence/feedback/reasoning
- Implemented classifyApprovalIntent function using LLM structured output
- Added comprehensive test coverage (36 tests) for all intent types, confidence levels, and edge cases
- Handled edge cases: empty messages, very long messages, emoji-only, LLM errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create approval classification module** - `32ea5c6` (feat)
2. **Task 2: Create approval classification tests** - `a0c10dc` (test)

## Files Created

- `packages/agents/src/dev-agent/classification/approval.ts` - LLM-based approval intent classification with Zod schema
- `packages/agents/src/dev-agent/classification/approval.test.ts` - Comprehensive unit tests (36 tests, 615 lines)

## Decisions Made

- **Flat Zod schema:** Following product-agent pattern for reliable LLM structured output
- **Four intent types:** approve, reject, unclear, question - covers all response categories
- **Feedback extraction:** Only populated for rejection intent to capture specific concerns
- **Empty message handling:** Short-circuit before LLM call with unclear/high confidence
- **Message truncation:** 4000 char limit to avoid LLM context overflow
- **Error fallback:** LLM errors return unclear/low - safer to ask for clarification than assume

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-commit hook required Biome formatting - auto-fixed with `pnpm run format`
- Test path needed to be relative to packages/agents directory - corrected filter path

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Approval classification module ready for use by:
  - Slack approval message handler (Plan 02-04)
  - Linear comment handler (Plan 05-07)
- Pattern established for natural language intent detection in human-in-the-loop flows

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
