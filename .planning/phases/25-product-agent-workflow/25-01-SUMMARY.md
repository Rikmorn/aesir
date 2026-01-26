---
phase: 25-product-agent-workflow
plan: 01
subsystem: agents
tags: [langchain, anthropic, structured-output, intent-classification, product-agent]

# Dependency graph
requires:
  - phase: 22.2-agent-mcp-migration
    provides: MCP communication layer for agent-integration communication
provides:
  - Intent classification node for product-agent
  - ClassificationType and ClassificationConfidence state fields
  - Five classification types: feature_request, bug_report, question, off_topic, unclear
  - Phase routing based on classification result
affects: [25-product-agent-workflow, graph-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - LLM structured output with Zod schema for reliable classification
    - Error fallback to conservative gathering phase
    - Flat schema structure for LLM reliability

key-files:
  created:
    - packages/agents/src/product-agent/nodes/classify.ts
    - packages/agents/src/product-agent/nodes/classify.test.ts
  modified:
    - packages/agents/src/product-agent/state.ts
    - packages/agents/src/product-agent/nodes/index.ts
    - packages/agents/src/product-agent/prompts.ts

key-decisions:
  - "Classification uses flat Zod schema for LLM structured output reliability"
  - "Low confidence on any type routes to clarifying phase"
  - "LLM errors fall back to gathering phase (conservative approach)"
  - "Decline responses for questions and off-topic included in classification output"

patterns-established:
  - "Intent classification before requirement gathering"
  - "Phase-based routing from classification result"
  - "Polite decline responses for non-actionable messages"

# Metrics
duration: 6min
completed: 2026-01-26
---

# Phase 25 Plan 01: Intent Classification Node Summary

**Intent classification node with structured output for filtering Slack messages into actionable (feature_request, bug_report) vs non-actionable (question, off_topic, unclear) types**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-26T00:26:20Z
- **Completed:** 2026-01-26T00:32:18Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Classification node filters messages before requirement gathering
- Five classification types with confidence scoring
- Polite decline responses for non-actionable messages
- Conservative error handling falls back to gathering phase
- Full unit test coverage (14 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add classification fields to state** - `1901b4e` (feat) - included in parallel plan 25-02 commit
2. **Task 2: Create classification node and prompt** - `56984c9` (feat)
3. **Task 3: Add unit tests for classification node** - `71fce22` (test)

## Files Created/Modified
- `packages/agents/src/product-agent/nodes/classify.ts` - Classification node with structured LLM output
- `packages/agents/src/product-agent/nodes/classify.test.ts` - Unit tests for all classification scenarios
- `packages/agents/src/product-agent/state.ts` - Added ClassificationType, ClassificationConfidence, declined phase
- `packages/agents/src/product-agent/nodes/index.ts` - Export classifyNode
- `packages/agents/src/product-agent/prompts.ts` - CLASSIFY_MESSAGE_PROMPT

## Decisions Made
- Used flat Zod schema structure for withStructuredOutput (avoids nested object parsing failures in LLMs)
- Low confidence classification always routes to clarifying regardless of type
- Error fallback to gathering phase allows analyze-requirements to handle ambiguous input
- Default decline responses provided for question/off_topic if LLM doesn't generate one

## Deviations from Plan

### Concurrent Execution Note

Task 1 (state field additions) was executed concurrently with Plan 25-02. The commit `1901b4e` by Plan 25-02 includes both the classification fields (this plan) and the issueDraft/awaitingConfirmation fields (25-02). This is expected behavior for parallel wave execution.

### Auto-fixed Issues

None - plan executed as written.

---

**Total deviations:** 0
**Impact on plan:** None

## Issues Encountered
- Biome lint required import sorting fixes (auto-fixed by biome check --write)
- Pre-commit hook caught formatting issues in test file

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Classification node ready for integration into product-agent graph
- Next plan can add classify node as entry point before analyze-requirements
- Routing logic needs to handle declined and clarifying phases from classification

---
*Phase: 25-product-agent-workflow*
*Plan: 01*
*Completed: 2026-01-26*
