---
phase: 62-router-updates
plan: 02
subsystem: agents
tags: [router, system-prompt, follow-up-routing, intent-classification, replyContext, channel-agnostic]

# Dependency graph
requires:
  - phase: 61-reply-context-infrastructure
    provides: "replyContext type system (ReplyContextSchema, Signal.replyContext, IncomingEvent.replyContext)"
provides:
  - "Channel-agnostic <follow_up_routing> section in router system prompt"
  - "Correlation key lookup table for Slack (threadTs), Linear (issueId), GitHub (future)"
  - "Unified follow-up routing procedure for all source channels"
  - "Minimal <reply_context> guidance for auto-injection"
  - "Channel-neutral intent classification"
affects: [62-03-tests, 63-outbound-denormalizer, 65-agent-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel-agnostic routing via correlation key lookup table in prompt"
    - "Separate routing from classification: <follow_up_routing> owns 'where', <intent_classification> owns 'what'"

key-files:
  created: []
  modified:
    - "packages/agents/src/router/system-prompt.ts"

key-decisions:
  - "Reopen flow: reopen_conversation first, THEN signal_conversation with message content (per CONTEXT.md)"
  - "No conversation found for follow-up = ignore (issues assigned via agent_session.created, not comments)"
  - "Agent echo filtering flagged as prerequisite note in prompt, not implemented (out of scope)"

patterns-established:
  - "Correlation key lookup table pattern: add one row per channel for new routing sources"
  - "Single procedure for all follow-up routing regardless of source channel"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 62 Plan 02: Router Prompt Rewrite Summary

**Channel-agnostic follow_up_routing section replacing Slack-specific routing, with correlation key lookup table for Slack/Linear/GitHub and minimal replyContext auto-injection guidance**

## Performance

- **Duration:** 2m 20s
- **Started:** 2026-02-08T23:30:48Z
- **Completed:** 2026-02-08T23:33:08Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced `<slack_thread_reply_routing>` with channel-agnostic `<follow_up_routing>` section covering all follow-up message types
- Added correlation key lookup table mapping Slack threadTs, Linear issueId, and GitHub (future) to correlationRef values
- Generalized intent classification to be channel-neutral across all source types
- Added minimal `<reply_context>` section documenting auto-injection behavior (2 sentences per CONTEXT.md)
- Unified tools section routing flow, removed Linear-specific "derive conversationId" shortcut
- Flagged agent echo filtering as production prerequisite in prompt note

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace slack_thread_reply_routing with channel-agnostic follow_up_routing** - `10180b9` (feat)
2. **Task 2: Generalize intent_classification and add replyContext guidance** - `5cd1767` (feat)

## Files Created/Modified
- `packages/agents/src/router/system-prompt.ts` - Router system prompt with unified follow-up routing, replyContext guidance, and channel-neutral intent classification

## Decisions Made
- Reopen flow documented as two-step: reopen_conversation with reason, then signal_conversation with signal type and message content -- per CONTEXT.md "classify by intent, reply by origin"
- Agent echo filtering noted as prerequisite in prompt rather than a separate TODO file -- keeps the dependency visible to the LLM router
- Kept "Slack thread" references in available_agents and routing_rules sections where they describe structural facts (product-agent ID pattern uses threadTs)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Router prompt is channel-agnostic and ready for Linear comment routing
- Plan 01 (tool schema changes) and Plan 03 (tests) can proceed independently
- Agent echo filtering remains a prerequisite before Linear comment routing goes to production

---
*Phase: 62-router-updates*
*Completed: 2026-02-08*
