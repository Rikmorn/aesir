---
phase: 43-smart-router-adaptation
plan: 01
subsystem: agents
tags: [adapters, event-routing, normalized-events, pass-through, domain-types]

# Dependency graph
requires:
  - phase: 42-event-router-adapters
    provides: Base adapter pattern (slack, github, linear) and IncomingEvent type
provides:
  - Complete adapter coverage for all 18 event types in the system
  - Pass-through fallback adapter (adaptPassThrough) for unrecognized events
  - Domain-language types for slack.message.created, github.pull_request.review_*, linear.comment.created, linear.agent_session.prompted
affects: [43-02 (adapter pipeline uses pass-through as fallback), event-router slow-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Switch fallthrough for related event variants (5 review types -> single handler)"
    - "Pass-through adapter as pipeline terminator (never-null guarantee)"

key-files:
  created:
    - packages/agents/src/adapters/pass-through.ts
    - packages/agents/src/adapters/pass-through.test.ts
  modified:
    - packages/agents/src/adapters/slack.ts
    - packages/agents/src/adapters/github.ts
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/index.ts
    - packages/agents/src/adapters/slack.test.ts
    - packages/agents/src/adapters/github.test.ts
    - packages/agents/src/adapters/linear.test.ts

key-decisions:
  - "PR review events have no correlationKey (branchName not in review payloads) -- always routes to slow_path"
  - "slack.message.created differentiates thread_reply vs channel_message based on threadTs presence"
  - "linear.agent_session.prompted falls back to payload.body when payload.prompt is absent"

patterns-established:
  - "Pass-through adapter pattern: fallback wrapping raw NormalizedEvent as generic IncomingEvent"
  - "Switch fallthrough for event variant groups: multiple case labels, single handler block"

# Metrics
duration: 4min
completed: 2026-02-03
---

# Phase 43 Plan 01: Missing Adapters + Pass-Through Summary

**Domain-language adapters for all remaining event types (slack messages, PR reviews, Linear comments/prompts) plus pass-through fallback ensuring zero nulls from adapter pipeline**

## Performance

- **Duration:** 3m 39s
- **Started:** 2026-02-03T01:37:11Z
- **Completed:** 2026-02-03T01:40:50Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- All 18 event types in the system now have domain-language adapters (10 from Phase 42 + 8 new)
- Pass-through adapter ensures adapter pipeline never produces null -- every event gets an IncomingEvent wrapper
- 35 total adapter tests passing (14 new tests added, 3 existing tests updated)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add missing adapter cases and pass-through adapter** - `7e8b04a` (feat)
2. **Task 2: Tests for new adapters and pass-through** - `a1277e6` (test)

## Files Created/Modified
- `packages/agents/src/adapters/pass-through.ts` - Fallback adapter wrapping any NormalizedEvent as generic IncomingEvent
- `packages/agents/src/adapters/pass-through.test.ts` - 4 tests for pass-through adapter
- `packages/agents/src/adapters/slack.ts` - Added slack.message.created -> thread_reply/channel_message
- `packages/agents/src/adapters/github.ts` - Added 5 pull_request.review_* variants -> pr_review
- `packages/agents/src/adapters/linear.ts` - Added comment.created -> issue_comment, agent_session.prompted -> agent_prompt
- `packages/agents/src/adapters/index.ts` - Added adaptPassThrough export
- `packages/agents/src/adapters/slack.test.ts` - 2 new tests for message.created
- `packages/agents/src/adapters/github.test.ts` - 5 new tests for review variants
- `packages/agents/src/adapters/linear.test.ts` - 3 new tests for comment + prompt

## Decisions Made
- PR review events intentionally have no correlationKey since review payloads do not include branchName -- these always route to slow_path for LLM classification
- slack.message.created produces "thread_reply" (with correlationKey = threadTs) or "channel_message" (no correlationKey) based on threadTs presence
- linear.agent_session.prompted falls back to payload.body when payload.prompt is absent -- handles both prompt formats

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated 3 existing "unrecognized type" tests**
- **Found during:** Task 2
- **Issue:** Existing tests used event types now handled by new adapter cases (e.g., `linear.comment.created` was the "unrecognized type" test fixture but is now a recognized type)
- **Fix:** Changed test fixtures to truly unrecognized types (e.g., `linear.some_unknown.type`, `slack.some_unknown.type`, `github.some_unknown.type`)
- **Files modified:** slack.test.ts, github.test.ts, linear.test.ts
- **Verification:** All 35 tests pass
- **Committed in:** a1277e6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correction to keep existing tests valid after adding new adapter cases. No scope creep.

## Issues Encountered
- Biome lint caught template string placeholder in test description string (`"${source}:webhook"`) -- changed to plain string format. Biome formatter also caught unnecessary line break in github.test.ts assertion. Both fixed before commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All adapters complete -- Plan 02 can now build the adapter pipeline with pass-through as the terminator
- adaptPassThrough exported from barrel for pipeline integration
- ALL_ADAPTERS array unchanged (pass-through is used after the pipeline, not inside it)

---
*Phase: 43-smart-router-adaptation*
*Completed: 2026-02-03*
