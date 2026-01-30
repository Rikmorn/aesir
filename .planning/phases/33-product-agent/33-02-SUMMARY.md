---
phase: 33-product-agent
plan: 02
subsystem: agents
tags: [product-agent, orchestrator, system-prompt, temporal, agentic-loop, phase-extraction]

# Dependency graph
requires:
  - phase: 28-agent-loop
    provides: runAgentLoop, TokenBudget, AgentLoopResult
  - phase: 29-context-traces
    provides: createTraceRecorder, agents DB schema
  - phase: 30-dev-agent-tools
    provides: createProductAgentToolkit, MCP tool wrappers
  - phase: 31-dev-agent-orchestrator
    provides: Orchestrator pattern (system prompts + entry point)
  - phase: 33-01
    provides: linear_search_issues MCP tool, product agent toolkit
provides:
  - runProductAgent() entry point for agentic conversation loop
  - PRODUCT_AGENT_SYSTEM_PROMPT with XML-tagged behavior sections
  - Rewritten Temporal activity using agentic loop (no LangGraph)
  - extractPhase() for XML phase tag parsing
  - extractIssueInfo() for trace-based issue extraction
  - Module-level DI for product agent activities
affects: [33-03 (product agent workflow), 33-04 (product agent integration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XML phase tags in agent output for workflow flow control"
    - "Conversation history injection as XML-tagged context in initial message"
    - "Trace-based issue extraction from linear_create_issue tool results"
    - "Module-level DI for product agent Temporal activities"

key-files:
  created:
    - packages/agents/src/product-agent/orchestrator/orchestrator.ts
    - packages/agents/src/product-agent/orchestrator/system-prompts.ts
    - packages/agents/src/product-agent/orchestrator/index.ts
  modified:
    - packages/agents/src/shared/temporal/activities/product-agent-activity.ts
    - packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts

key-decisions:
  - "Product agent system prompt uses 6 XML sections: identity, conversation_rules, behavior, issue_quality, cancellation_detection, duplicate_detection"
  - "Phase extraction via regex on <phase> XML tags with safe default to awaiting_reply"
  - "Issue info extracted from trace by finding tool_result steps for linear_create_issue and parsing JSON output"
  - "Conversation history injected as XML <conversation_history> block in initial message, not as separate API turns"
  - "Module-level DI pattern for product agent activities (matches orchestrator-activities.ts)"

patterns-established:
  - "Product agent orchestrator: threadTs + channelId + message + history -> runAgentLoop"
  - "Phase tag extraction as workflow flow control mechanism"
  - "Trace mining for created entity IDs (issueId from linear_create_issue)"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 33 Plan 02: Product Agent Orchestrator and Temporal Activity Summary

**runProductAgent() entry point with XML-tagged system prompt, and rewritten Temporal activity using agentic loop with phase extraction and trace-based issue info**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-30T15:22:03Z
- **Completed:** 2026-01-30T15:27:23Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments
- Created product agent orchestrator entry point following the dev-agent pattern exactly
- System prompt defines all agent behavior with 6 XML sections (no hardcoded control flow)
- Temporal activity fully rewritten -- zero LangGraph dependencies remain
- Phase extraction parses XML tags from agent output for workflow flow control
- Issue info extracted from execution trace by mining linear_create_issue tool results
- 21 tests passing for the rewritten activity (extractPhase, extractIssueInfo, DI, integration)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create product agent orchestrator and system prompt** - `b677572` (feat)
2. **Task 2: Rewrite product agent Temporal activity** - `727d46b` (feat)

## Files Created/Modified
- `packages/agents/src/product-agent/orchestrator/system-prompts.ts` - PRODUCT_AGENT_SYSTEM_PROMPT with identity, conversation_rules, behavior, issue_quality, cancellation_detection, duplicate_detection
- `packages/agents/src/product-agent/orchestrator/orchestrator.ts` - runProductAgent() wiring token budget, trace recorder, toolkit, and runAgentLoop()
- `packages/agents/src/product-agent/orchestrator/index.ts` - Barrel export for orchestrator module
- `packages/agents/src/shared/temporal/activities/product-agent-activity.ts` - Completely rewritten: runProductAgent() instead of LangGraph, extractPhase(), extractIssueInfo(), module-level DI
- `packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts` - Rewritten test suite: 21 tests covering extractPhase (8), extractIssueInfo (7), runProductAgentActivity (6)

## Decisions Made
- System prompt uses 6 XML sections matching the dev-agent orchestrator pattern but adapted for conversational product agent behavior (clarifying, completing, declining, cancelling)
- Phase extraction defaults to "awaiting_reply" when no tag found -- safe default that continues conversation rather than terminating prematurely
- Issue info extracted from trace steps rather than from structured output -- the agent creates issues via tool calls, and the trace records the tool results
- Conversation history injected as XML `<conversation_history>` block in the initial message, not as separate API message turns -- avoids Anthropic API role alternation constraints
- Module-level DI with initProductAgentActivities() matches the orchestrator-activities.ts pattern for Temporal worker initialization

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rewrote existing test file for new implementation**
- **Found during:** Task 2
- **Issue:** Existing product-agent-activity.test.ts tested the LangGraph-based implementation (mocked createProductAgentGraph, HumanMessage, checkpointer). The complete rewrite requires new tests.
- **Fix:** Rewrote test file with 21 tests covering extractPhase (8 cases), extractIssueInfo (7 cases), and runProductAgentActivity (6 cases including DI and conversationHistory handling)
- **Files modified:** `packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts`
- **Verification:** All 21 tests pass
- **Committed in:** `727d46b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test rewrite is the direct consequence of the planned activity rewrite. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- runProductAgent() ready for Temporal workflow integration (33-03)
- extractPhase() ready for workflow flow control (clarifying -> wait, complete -> done)
- extractIssueInfo() ready for workflow to track created issues
- initProductAgentActivities() ready for worker.ts initialization
- Activity input interface includes channelId and conversationHistory for workflow to populate

---
*Phase: 33-product-agent*
*Completed: 2026-01-30*
