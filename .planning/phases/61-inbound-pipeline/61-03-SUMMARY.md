---
phase: 61-inbound-pipeline
plan: 03
subsystem: agents
tags: [reply-context, executor, worker-loop, event-router, signal, xml-tag]

# Dependency graph
requires:
  - phase: 61-01
    provides: "Schema extensions (SignalSchema.replyContext, StartConversationParams.replyContext, IncomingEventSchema.replyContext, appendReplyContextTag)"
provides:
  - "End-to-end replyContext flow from adapters through executor to agent messages"
  - "Executor signal() stores reply_context on conversation row and appends XML tag"
  - "Executor start() stores reply_context and appends XML tag to initial message"
  - "Worker loop signal consumption (pre-claim and post-wait_for) appends XML tags"
  - "EventRouter forwards replyContext from IncomingEvent to Signal"
  - "Task routing forwards replyContext in both signal and start paths"
affects: [62-denormalizer, 63-communication-tools, 64-agent-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional spread for exactOptionalPropertyTypes compliance: ...(x && { key: x })"
    - "appendReplyContextTag used at all 5 message construction sites for consistent XML tag injection"

key-files:
  created: []
  modified:
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/event-router.ts
    - packages/agents/src/router/router.ts
    - packages/agents/src/framework/conversation-executor.test.ts
    - packages/agents/src/framework/event-router.test.ts

key-decisions:
  - "Used conditional spread pattern for replyContext forwarding to satisfy exactOptionalPropertyTypes"
  - "reply_context column only updated on signal() when replyContext is present (preserves existing value)"

patterns-established:
  - "Conditional spread for optional typed properties: ...(value && { key: value })"

# Metrics
duration: 5min
completed: 2026-02-08
---

# Phase 61 Plan 03: Executor & Router ReplyContext Wiring Summary

**ReplyContext wired end-to-end through executor signal/start, worker loop signal consumption, EventRouter, and task routing with XML tag injection at all message construction sites**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-08T22:29:26Z
- **Completed:** 2026-02-08T22:34:09Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Executor signal() appends `<reply_context>` XML tag to signal messages and conditionally updates `reply_context` column
- Executor start() stores replyContext on conversation row and appends XML tag to initial message (both new and re-trigger paths)
- Worker loop pre-claim and post-wait_for signal consumption sites append XML tags via appendReplyContextTag
- EventRouter forwards replyContext from IncomingEvent to Signal objects
- Task routing forwards replyContext in both signal delivery and conversation start paths
- Router start path passes replyContext from event through to executor.start()

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire replyContext through executor signal() and start()** - `f09094a` (feat)
2. **Task 2: Wire replyContext through worker loop, EventRouter, and task routing** - `6f6d165` (feat)

## Files Created/Modified
- `packages/agents/src/framework/conversation-executor.ts` - signal() and start() with replyContext wiring
- `packages/agents/src/framework/worker-loop.ts` - Signal consumption with replyContext tag appending
- `packages/agents/src/framework/event-router.ts` - EventRouter forwarding replyContext to Signal
- `packages/agents/src/router/router.ts` - Task routing and start path forwarding replyContext
- `packages/agents/src/framework/conversation-executor.test.ts` - 7 new tests for replyContext propagation
- `packages/agents/src/framework/event-router.test.ts` - 2 new tests for replyContext forwarding

## Decisions Made
- Used conditional spread pattern `...(x && { key: x })` for replyContext forwarding to satisfy TypeScript exactOptionalPropertyTypes (prevents assigning undefined to optional properties)
- reply_context column only updated in signal() when replyContext is present, preserving existing value when signal has no replyContext

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing template literal lint in worker-loop.ts**
- **Found during:** Task 2
- **Issue:** Biome lint flagged string concatenation `taskContextBlock + "\n\n" + firstMsg.content` as preferring template literals
- **Fix:** Changed to template literal syntax
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** Biome lint passes
- **Committed in:** 6f6d165 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes type error in router.ts**
- **Found during:** Task 2
- **Issue:** Directly assigning `event.replyContext` (which can be `undefined`) to `Signal.replyContext` and `StartConversationParams.replyContext` violated TypeScript's exactOptionalPropertyTypes. The property must either not exist or be the correct type -- not `undefined`.
- **Fix:** Used conditional spread pattern `...(event.replyContext && { replyContext: event.replyContext })` in all three forwarding sites
- **Files modified:** packages/agents/src/router/router.ts, packages/agents/src/framework/event-router.ts
- **Verification:** TypeScript typecheck passes
- **Committed in:** 6f6d165 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking lint, 1 type error)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ReplyContext flows end-to-end: adapters extract it (Plan 02), executor stores and tags messages (this plan)
- Phase 62 (denormalizer) can now read reply_context from conversation rows
- Phase 63 (communication tools) can read XML tags from conversation messages
- All existing tests pass with zero regressions

## Self-Check: PASSED

All 7 files verified present. Commits f09094a and 6f6d165 confirmed in git log. appendReplyContextTag usage confirmed in conversation-executor.ts (4 refs), worker-loop.ts (3 refs). replyContext forwarding confirmed in event-router.ts and router.ts.

---
*Phase: 61-inbound-pipeline*
*Completed: 2026-02-08*
