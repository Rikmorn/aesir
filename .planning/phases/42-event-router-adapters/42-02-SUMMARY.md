---
phase: 42-event-router-adapters
plan: 02
subsystem: agents
tags: [router, conversation-executor, slow-path, llm-classification, domain-signals]

# Dependency graph
requires:
  - phase: 40-executor-core
    provides: ConversationExecutor interface (start/signal/get/list/cancel)
  - phase: 42-01
    provides: IncomingEvent type and adapter pure functions
provides:
  - EventRouterDeps interface (executor-based, replaces RouterDeps)
  - start_conversation tool (ConversationExecutor.start)
  - signal_conversation tool (ConversationExecutor.signal with domain-language types)
  - query_conversations tool (ConversationExecutor.get/list)
  - routeViaAgentLoopV2 (slow-path function using conversation tools)
  - ROUTER_SYSTEM_PROMPT_V2 (conversation terminology, domain signal types)
affects: [42-03-router-entry-point, 47-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coexistence pattern: new v2.3 tools/functions alongside old Temporal-based ones"
    - "Domain-language signals: approval, pr_review, pr_merged instead of planApproval, prFeedback, prCompletion"
    - "EventRouterDeps with ConversationExecutor replacing RouterDeps with Temporal Client"

key-files:
  created:
    - packages/agents/src/router/tools/start-conversation.ts
    - packages/agents/src/router/tools/signal-conversation.ts
    - packages/agents/src/router/tools/query-conversations.ts
  modified:
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/slow-path.ts
    - packages/agents/src/router/system-prompt.ts

key-decisions:
  - "Domain-language signal types (approval, pr_review, pr_merged, pr_closed, etc.) instead of Temporal signal names (planApproval, prFeedback, prCompletion)"
  - "split prCompletion into pr_merged and pr_closed for more precise signal semantics"
  - "createSendMessageTool reused as-is with type cast since _deps parameter is unused"
  - "query_conversations uses executor.get() for taskId lookups (pattern match) and executor.list() for general queries"

patterns-established:
  - "Tool coexistence: new conversation tools alongside old workflow tools until Phase 47"
  - "EventRouterDeps parallel to RouterDeps: both exported from types.ts"

# Metrics
duration: 4min
completed: 2026-02-02
---

# Phase 42 Plan 02: Router Tool Adapters Summary

**Conversation-based slow-path router tools using ConversationExecutor with domain-language signal types (approval, pr_review, pr_merged, etc.)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-02T21:12:17Z
- **Completed:** 2026-02-02T21:16:24Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Three new router tools (start_conversation, signal_conversation, query_conversations) that call ConversationExecutor exclusively with zero Temporal imports
- EventRouterDeps interface coexisting alongside existing RouterDeps
- routeViaAgentLoopV2 using conversation-based tools and ROUTER_SYSTEM_PROMPT_V2
- Domain-language signal types replacing Temporal signal names (approval vs planApproval, pr_merged/pr_closed vs prCompletion)
- All 59 existing router tests pass without regression

## Task Commits

Each task was committed atomically:

1. **Task 1: EventRouterDeps type and adapted router tools** - `c21fe60` (feat)
2. **Task 2: Update slow-path and system prompt for conversation terminology** - `bc37d07` (feat)

## Files Created/Modified
- `packages/agents/src/router/types.ts` - Added EventRouterDeps interface alongside RouterDeps
- `packages/agents/src/router/tools/start-conversation.ts` - start_conversation tool using executor.start()
- `packages/agents/src/router/tools/signal-conversation.ts` - signal_conversation tool with domain signal types
- `packages/agents/src/router/tools/query-conversations.ts` - query_conversations tool using executor.get()/list()
- `packages/agents/src/router/slow-path.ts` - Added routeViaAgentLoopV2 alongside existing function
- `packages/agents/src/router/system-prompt.ts` - Added ROUTER_SYSTEM_PROMPT_V2 with conversation terminology

## Decisions Made
- Split prCompletion into pr_merged and pr_closed for more precise signal semantics -- the old single signal was ambiguous
- Reused createSendMessageTool with type cast since _deps parameter is completely unused (verified by code inspection)
- query_conversations uses executor.get() for specific taskId lookups (checking both agent patterns) rather than filtering list results -- more efficient for single-ID queries
- Used explicit listOptions construction to satisfy exactOptionalPropertyTypes when agentDefinitionId is undefined

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed exactOptionalPropertyTypes incompatibility**
- **Found during:** Task 1 (query-conversations.ts)
- **Issue:** Passing undefined agentDefinitionId directly to executor.list() fails with exactOptionalPropertyTypes enabled
- **Fix:** Built listOptions object conditionally, only adding agentDefinitionId when defined
- **Files modified:** packages/agents/src/router/tools/query-conversations.ts
- **Verification:** npx tsc --noEmit passes cleanly
- **Committed in:** c21fe60 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor TypeScript strictness fix. No scope creep.

## Issues Encountered
- Biome formatter required multi-line import for ROUTER_SYSTEM_PROMPT imports and single-line for type imports -- fixed formatting to match Biome preferences

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Router tools ready for integration into top-level EventRouter entry point (Plan 03)
- EventRouterDeps interface available for Plan 03's unified router
- Old RouterDeps and Temporal-based tools preserved for Phase 47 cleanup

---
*Phase: 42-event-router-adapters*
*Completed: 2026-02-02*
