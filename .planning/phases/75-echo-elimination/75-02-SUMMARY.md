---
phase: 75-echo-elimination
plan: 02
subsystem: integrations
tags: [webhooks, normalization, echo-detection, linear, github, slack]

# Dependency graph
requires:
  - phase: 75-echo-elimination
    provides: "actorInfo type, echo env config (Plan 01)"
provides:
  - "actorType in Linear NormalizedEvent payloads (Comment + AgentSession)"
  - "sender (login + type) in GitHub NormalizedEvent payloads (PR review, closed, merged)"
  - "apiAppId in Slack NormalizedEvent payloads (message, app_mention)"
affects: [75-echo-elimination]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional spread pattern for conditional payload fields: ...(field && { key: field })"

key-files:
  created: []
  modified:
    - packages/integrations/github/src/dispatcher/normalize.ts
    - packages/integrations/github/src/api/webhooks.ts
    - packages/integrations/slack/src/dispatcher/normalize.ts

key-decisions:
  - "Linear changes already shipped in Plan 01 -- no duplicate commit needed"
  - "Extract sender from raw JSON.parse (not Zod schema) in GitHub handler to avoid schema changes"
  - "Use 'in' operator check on payload.raw for api_app_id in Slack to handle discriminated union typing"

patterns-established:
  - "Actor metadata spread pattern: ...(actor && { actor }) for optional echo detection fields"

requirements-completed: [ECHO-02]

# Metrics
duration: 3min
completed: 2026-02-16
---

# Phase 75 Plan 02: Thread Actor Metadata Summary

**Thread actorType/sender/apiAppId through Linear, GitHub, and Slack normalizers for echo detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T22:51:03Z
- **Completed:** 2026-02-16T22:54:21Z
- **Tasks:** 2 (1 already completed by Plan 01, 1 executed)
- **Files modified:** 3

## Accomplishments
- GitHub normalize functions accept optional sender parameter and include it in NormalizedEvent payload
- Slack normalize functions extract api_app_id from Events API raw payload and include as apiAppId
- Linear changes confirmed already complete from Plan 01 (actorType in Comment + AgentSession payloads)
- All 262 integration tests pass (79 Linear + 73 GitHub + 110 Slack)
- Zero type errors across all three integration packages

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread actor data through Linear normalizers** - Already committed in `599f06f` (Plan 01)
2. **Task 2: Thread actor data through GitHub and Slack normalizers** - `d6b36ee` (feat)

## Files Created/Modified
- `packages/integrations/github/src/dispatcher/normalize.ts` - Added optional sender param to normalizePRReviewEvent, normalizePRMergedEvent, normalizePRClosedEvent
- `packages/integrations/github/src/api/webhooks.ts` - Extract sender from raw payload and pass to normalize functions
- `packages/integrations/slack/src/dispatcher/normalize.ts` - Added apiAppId from payload.raw.api_app_id to message and app_mention events

## Decisions Made
- Linear changes (actorType in Comment + AgentSession payloads) were already committed by Plan 01. Rather than creating a duplicate no-op commit, documented this overlap and proceeded to Task 2.
- For GitHub, extracted sender from raw JSON.parse rather than modifying Zod schemas, since the sender field is only needed for passthrough (not validation).
- For Slack, used `"api_app_id" in payload.raw` check to handle TypeScript discriminated union typing safely.

## Deviations from Plan

### Task 1 Overlap with Plan 01

Task 1 (Linear normalizer changes) was already completed by Plan 01 (`599f06f`). The Linear files (normalize.ts, parser.ts, types.ts) were already modified with actorType threading. This is a plan overlap, not an error -- Plan 01 included these changes as part of its broader "add webhook dedup migration, actorInfo type, echo env config" commit.

No auto-fix deviations occurred during Task 2 execution.

---

**Total deviations:** 0 auto-fixed. 1 plan overlap (Task 1 pre-completed by Plan 01).
**Impact on plan:** No scope creep. Plan 01 overlap reduced work but the end result matches all success criteria.

## Issues Encountered
None -- all changes applied cleanly and passed verification on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three integration normalizers now include actor identification metadata in NormalizedEvent.payload
- Plan 03 (agent-service adapters) can read actorType/sender/apiAppId from normalized event payloads to populate actorInfo for the echo filter

## Self-Check: PASSED

- All modified files exist on disk
- All commit hashes found in git log
- Key content (sender, apiAppId, actorType) present in target files

---
*Phase: 75-echo-elimination*
*Completed: 2026-02-16*
