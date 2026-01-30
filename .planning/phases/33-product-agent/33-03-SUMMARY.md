---
phase: 33-product-agent
plan: 03
subsystem: agents
tags: [product-agent, temporal, workflow, worker, langgraph-removal, agentic-loop]

# Dependency graph
requires:
  - phase: 33-02
    provides: runProductAgent orchestrator, rewritten Temporal activity, extractPhase, initProductAgentActivities
provides:
  - Updated Temporal workflow with conversation history tracking and channelId passing
  - Worker using DB-backed activity deps instead of LangGraph checkpointer
  - All LangGraph code removed (21 files deleted)
  - Clean barrel export exposing only orchestrator module
affects: [33-04 (product agent integration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conversation history tracking in workflow state for multi-turn context"
    - "Agent self-messaging (workflow does not send Slack replies after agent turns)"
    - "Module-level DI with agents shared db/client for worker initialization"

key-files:
  created: []
  modified:
    - packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts
    - packages/agents/src/shared/temporal/activities/index.ts
    - packages/agents/src/shared/temporal/types.ts
    - packages/agents/src/product-agent/worker.ts
    - packages/agents/src/product-agent/index.ts
  deleted:
    - packages/agents/src/product-agent/workflow/ (19 files)
    - packages/agents/src/product-agent/slack/ (2 files)
    - packages/agents/src/product-agent/integration.test.ts

key-decisions:
  - "Agent sends its own Slack messages -- workflow only sends system messages (reminders, timeouts, cancellation)"
  - "Conversation history tracked as array in workflow state, passed to activity each turn"
  - "Worker uses agents shared db/client (pool-based) instead of creating new connection"
  - "sendSlackReplyActivity retained for workflow-level messages, removed only after agent turns"

patterns-established:
  - "Self-messaging agent pattern: workflow delegates user communication entirely to the agentic loop"
  - "Conversation history injection at workflow level for cross-activity context continuity"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 33 Plan 03: Temporal Workflow, Worker, and LangGraph Cleanup Summary

**Updated Temporal workflow to pass channelId + conversation history, rewrote worker for DB-backed activity deps, deleted all LangGraph code (21 files, 5759 lines)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-30T15:30:48Z
- **Completed:** 2026-01-30T15:35:42Z
- **Tasks:** 2
- **Files modified:** 5
- **Files deleted:** 22 (19 workflow + 2 slack + 1 integration test)
- **Lines removed:** 5,759

## Accomplishments
- Temporal workflow now tracks conversation history and passes channelId to the product agent activity
- Agent handles its own Slack communication -- workflow no longer calls sendSlackReplyActivity after agent turns
- sendSlackReplyActivity retained for system messages: cancellation ack, 24h reminder, 72h timeout, max iterations
- Worker uses initProductAgentActivities with agents shared db/client instead of LangGraph checkpointer
- All LangGraph files deleted: workflow/ (19 files), slack/ (2 files), integration.test.ts
- Barrel export updated to only expose runProductAgent, ProductAgentOptions, PRODUCT_AGENT_SYSTEM_PROMPT
- activities/index.ts updated with initProductAgentActivities and extractPhase re-exports
- types.ts LangGraph references replaced with "agentic loop" terminology
- Typecheck, build, and all 944 tests pass (0 failures, 61 test files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Temporal workflow and worker** - `8fb188a` (feat)
2. **Task 2: Delete LangGraph files and update barrel exports** - `b862ae3` (refactor)

## Files Modified
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` - Added conversation history tracking, pass channelId to activity, removed sendSlackReplyActivity after agent turns
- `packages/agents/src/shared/temporal/activities/index.ts` - Added initProductAgentActivities, extractPhase, ProductAgentActivityDeps exports
- `packages/agents/src/shared/temporal/types.ts` - Replaced LangGraph references with agentic loop terminology
- `packages/agents/src/product-agent/worker.ts` - DB-backed activity init via initProductAgentActivities, removed checkpointer
- `packages/agents/src/product-agent/index.ts` - Barrel export: only orchestrator module (runProductAgent, ProductAgentOptions, PRODUCT_AGENT_SYSTEM_PROMPT)

## Files Deleted (22 total)
- `packages/agents/src/product-agent/workflow/` - 19 files (graph, state, prompts, runner, checkpointer, 6 nodes, index, 5 test files)
- `packages/agents/src/product-agent/slack/` - 2 files (index.ts, thread-handlers.ts)
- `packages/agents/src/product-agent/integration.test.ts` - LangGraph graph integration test

## Decisions Made
- Agent sends its own Slack messages via slack_send_message tool during its agentic loop. The workflow's response field contains internal reasoning + phase tag, NOT user-facing text, so it must not be sent to Slack.
- sendSlackReplyActivity retained in the workflow for system-level messages: cancellation acknowledgment, 24h inactivity reminder, 72h timeout, and max iterations notification.
- Conversation history tracked as mutable array in workflow state. Each turn appends user message before activity call and agent response after. Passed to activity so the agentic loop has full multi-turn context.
- Worker uses the agents shared db/client module (pool-based connection) with a type cast to ProductAgentActivityDeps["db"], matching the pattern used by the dev-agent orchestrator worker.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Temporal workflow fully updated for agentic architecture
- Worker initializes correctly with DB-backed deps
- All LangGraph code removed -- clean slate for Phase 34 (Smart Router)
- Product agent barrel export ready for consumption by event handlers
- 944 tests passing, zero regressions

---
*Phase: 33-product-agent*
*Completed: 2026-01-30*
