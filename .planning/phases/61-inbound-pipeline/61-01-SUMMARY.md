---
phase: 61-inbound-pipeline
plan: 01
subsystem: agents
tags: [zod, schema, reply-context, communication, xml-tag]

# Dependency graph
requires:
  - phase: 60-communication-types
    provides: ReplyContextSchema and ReplyContext types in shared/communication/types.ts
provides:
  - IncomingEventSchema with optional replyContext field
  - SignalSchema with optional replyContext field
  - StartConversationParams with optional replyContext field
  - appendReplyContextTag() message utility helper
affects: [61-02 adapter extraction, 61-03 executor wiring, 62 denormalizer, 63 communication tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XML tag injection pattern for agent message enrichment (appendReplyContextTag)"

key-files:
  created:
    - packages/agents/src/shared/communication/message-utils.ts
  modified:
    - packages/agents/src/adapters/types.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/shared/communication/index.ts

key-decisions:
  - "replyContext placed after taskId in all schemas for consistent ordering"
  - "appendReplyContextTag uses XML tag format (<reply_context>JSON</reply_context>) for LLM-parseable structured data"

patterns-established:
  - "XML tag injection: appendReplyContextTag wraps structured data in XML tags for agent consumption"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 61 Plan 01: Schema Extensions Summary

**Optional replyContext fields added to IncomingEvent, Signal, and StartConversationParams schemas with appendReplyContextTag XML helper**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T22:25:22Z
- **Completed:** 2026-02-08T22:27:22Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Extended IncomingEventSchema with optional replyContext (Zod discriminated union)
- Extended SignalSchema with optional replyContext for signal-based resume routing
- Extended StartConversationParams interface with optional ReplyContext type
- Created appendReplyContextTag() helper that injects XML-wrapped reply context into messages
- Exported appendReplyContextTag from communication barrel index

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend schemas with optional replyContext and create message utility** - `04fdf1c` (feat)

## Files Created/Modified
- `packages/agents/src/shared/communication/message-utils.ts` - appendReplyContextTag() helper function
- `packages/agents/src/adapters/types.ts` - IncomingEventSchema with optional replyContext
- `packages/agents/src/framework/types.ts` - SignalSchema and StartConversationParams with optional replyContext
- `packages/agents/src/shared/communication/index.ts` - Barrel export for appendReplyContextTag

## Decisions Made
- replyContext placed after taskId in all schemas for consistent field ordering
- appendReplyContextTag uses XML tag format for LLM-parseable structured data injection

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Schema extensions are backward-compatible (all optional fields)
- Plans 61-02 (adapter extraction) and 61-03 (executor wiring) can proceed
- appendReplyContextTag ready for use by executor when injecting reply context into initial messages

## Self-Check: PASSED

All files verified present. Commit 04fdf1c confirmed in git log.

---
*Phase: 61-inbound-pipeline*
*Completed: 2026-02-08*
