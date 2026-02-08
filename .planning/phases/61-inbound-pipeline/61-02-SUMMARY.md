---
phase: 61-inbound-pipeline
plan: 02
subsystem: agents
tags: [adapters, reply-context, slack, linear, github, zod]

# Dependency graph
requires:
  - phase: 61-01
    provides: IncomingEventSchema with optional replyContext field, ReplyContextSchema
provides:
  - Slack adapter replyContext extraction for app_mention and thread_reply events
  - Linear adapter replyContext extraction for agent_session, comment, and prompt events
  - GitHub adapter replyContext extraction for PR merged, closed, and review events
  - Comprehensive tests verifying presence and absence of replyContext
affects: [61-03 executor wiring, 62 denormalizer, 63 communication tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional spread pattern for optional replyContext extraction in adapters"
    - "Graceful degradation: replyContext omitted when required fields missing"

key-files:
  created: []
  modified:
    - packages/agents/src/adapters/slack.ts
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/github.ts
    - packages/agents/src/adapters/slack.test.ts
    - packages/agents/src/adapters/linear.test.ts
    - packages/agents/src/adapters/github.test.ts

key-decisions:
  - "Slack block_actions events omit replyContext because teamId is not available in NormalizedEvent for those events"
  - "GitHub replyContext extracts owner and repo from payload.repository (not payload directly)"

patterns-established:
  - "Conditional spread for replyContext: ...(field1 && field2 && { replyContext: { ... } })"

# Metrics
duration: 5min
completed: 2026-02-08
---

# Phase 61 Plan 02: Adapter ReplyContext Extraction Summary

**All three adapters (Slack, Linear, GitHub) extract replyContext from payload fields with graceful degradation when data is missing**

## Performance

- **Duration:** 4m 37s
- **Started:** 2026-02-08T22:29:28Z
- **Completed:** 2026-02-08T22:34:05Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Slack adapter extracts replyContext (teamId, channelId, threadTs) for app_mention and thread_reply events
- Linear adapter extracts replyContext (issueId) for agent_session.created, comment.created, and agent_session.prompted events
- GitHub adapter extracts replyContext (owner, repo, prNumber) from payload.repository for PR merged, closed, and review events
- All adapters gracefully omit replyContext when required fields are missing
- 45 total adapter tests pass (15 Slack, 12 Linear, 18 GitHub)

## Task Commits

Each task was committed atomically:

1. **Task 1: Slack and Linear adapter replyContext** - `5694e61` (feat)
2. **Task 2: GitHub adapter replyContext** - `217d115` (feat)

## Files Created/Modified
- `packages/agents/src/adapters/slack.ts` - Added replyContext extraction for app_mention and thread_reply
- `packages/agents/src/adapters/linear.ts` - Added replyContext for agent_session.created, comment.created, agent_session.prompted
- `packages/agents/src/adapters/github.ts` - Added replyContext from payload.repository for PR events
- `packages/agents/src/adapters/slack.test.ts` - Tests for replyContext presence/absence on Slack events
- `packages/agents/src/adapters/linear.test.ts` - Tests for replyContext presence/absence on Linear events
- `packages/agents/src/adapters/github.test.ts` - Tests for replyContext presence/absence on GitHub events

## Decisions Made
- Slack block_actions events (approved, rejected, escalation_retry, escalation_abort) do NOT include replyContext because teamId is not available in the NormalizedEvent payload for those events
- GitHub replyContext extracts owner from `payload.repository.owner` and repo from `payload.repository.name` (repository object structure from normalizer)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Parallel plan overlap with 61-03 on adapter files**
- **Found during:** Task 1
- **Issue:** Plan 61-03 (executor wiring) committed changes to adapter files (slack.ts, linear.ts, slack.test.ts, linear.test.ts) that overlapped with this plan's ownership. Both plans added identical replyContext extraction logic.
- **Fix:** Task 1 commit reformatted the one-liner replyContext spreads to multi-line format to pass Biome formatter. No logic changes needed since 61-03 had already added the same extraction code.
- **Files modified:** packages/agents/src/adapters/slack.ts
- **Verification:** All 45 adapter tests pass, typecheck passes
- **Committed in:** 5694e61

---

**Total deviations:** 1 auto-fixed (1 blocking - parallel overlap)
**Impact on plan:** Minimal - parallel agent added the same logic. Task 1 commit was effectively a formatting fix. Task 2 (GitHub) was unaffected.

## Issues Encountered
- Parallel execution overlap: Plan 61-03 modified adapter files that were owned by this plan (61-02). This is a known risk of parallel execution. The changes were compatible (identical logic), so no conflicts occurred.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three adapters now extract replyContext from available payload data
- Events without sufficient data gracefully omit replyContext (no errors)
- Ready for downstream consumption by executor wiring (61-03) and denormalizer (phase 62)

---
*Phase: 61-inbound-pipeline*
*Completed: 2026-02-08*
