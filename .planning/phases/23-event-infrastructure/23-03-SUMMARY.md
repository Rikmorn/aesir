---
phase: 23-event-infrastructure
plan: 03
subsystem: events
tags: [github, webhooks, event-dispatch, normalized-events, http-client]

# Dependency graph
requires:
  - phase: 23-event-infrastructure/01
    provides: NormalizedEventSchema, createId.event(), nginx webhook config
provides:
  - GitHub dispatcher module for normalizing and dispatching PR review events
  - normalizePRReviewEvent converter to NormalizedEvent format
  - Fire-and-forget HTTP dispatch client for agent communication
affects: [23-05, dev-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget dispatch pattern (async HTTP POST, log errors, don't block)"
    - "Event type includes review state for fine-grained routing (review_approved, review_changes_requested)"

key-files:
  created:
    - packages/integrations/github/src/dispatcher/routes.ts
    - packages/integrations/github/src/dispatcher/client.ts
    - packages/integrations/github/src/dispatcher/normalize.ts
    - packages/integrations/github/src/dispatcher/index.ts
  modified:
    - packages/integrations/github/src/webhooks/parser.ts
    - packages/integrations/github/src/api/webhooks.ts

key-decisions:
  - "Extended PR review schema to include html_url, submitted_at, full_name fields for complete event payloads"
  - "Event type includes review state (review_approved, review_changes_requested, etc.) for fine-grained agent routing"
  - "All review states routed to dev-agent with mode based on urgency (sync for changes_requested, async for commented)"

patterns-established:
  - "GitHub dispatcher follows same pattern as Linear dispatcher (routes, client, normalize modules)"
  - "Fire-and-forget dispatch with timeout based on mode (5s async, 30s sync)"

# Metrics
duration: 2min
completed: 2026-01-25
---

# Phase 23 Plan 03: GitHub Event Dispatcher Summary

**GitHub PR review webhook normalization and fire-and-forget dispatch to dev-agent:3004/events**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-25T21:53:27Z
- **Completed:** 2026-01-25T21:55:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created GitHub dispatcher module with routes, client, and normalization
- Extended webhook parser schema with html_url, submitted_at, full_name for complete event data
- Integrated dispatcher into GitHub webhook handler for automatic event dispatch

## Task Commits

Each task was committed atomically:

1. **Task 1: Create GitHub dispatcher module** - `2a4a4e5` (feat)
2. **Task 2: Integrate dispatcher into GitHub webhook handler** - `b1756ed` (feat)

## Files Created/Modified
- `packages/integrations/github/src/dispatcher/routes.ts` - Dispatch route config targeting dev-agent:3004/events
- `packages/integrations/github/src/dispatcher/client.ts` - Fire-and-forget HTTP dispatch client
- `packages/integrations/github/src/dispatcher/normalize.ts` - PR review to NormalizedEvent converter
- `packages/integrations/github/src/dispatcher/index.ts` - Barrel export
- `packages/integrations/github/src/webhooks/parser.ts` - Extended with html_url, submitted_at, full_name fields
- `packages/integrations/github/src/api/webhooks.ts` - Integrated dispatcher call after PR review processing

## Decisions Made
- **Extended webhook schema:** Added html_url (PR URL), submitted_at (review timestamp), and full_name (repo full name) to the PR review payload schema. These fields exist in GitHub's actual webhook payload but weren't captured in the original minimal schema.
- **Event type granularity:** Event type includes the review state (github.pull_request.review_approved, review_changes_requested, etc.) rather than just "review_submitted" to enable fine-grained routing in agents.
- **Route modes:** Changes requested uses sync mode (30s timeout) since dev-agent should process immediately; commented uses async mode (5s timeout) since it's less urgent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended webhook parser schema**
- **Found during:** Task 1 (Create dispatcher module)
- **Issue:** Plan referenced html_url, submitted_at, and full_name fields in normalize.ts but these weren't in the existing parser schema
- **Fix:** Extended PullRequestSchema (html_url), ReviewSchema (submitted_at), and RepositorySchema (full_name) with required fields
- **Files modified:** packages/integrations/github/src/webhooks/parser.ts
- **Verification:** Typecheck passes, normalization function compiles
- **Committed in:** 2a4a4e5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Schema extension was necessary for proper event normalization. No scope creep - fields already exist in GitHub webhook payloads.

## Issues Encountered
None - plan executed as written after schema extension.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- GitHub dispatcher ready to send normalized PR review events to dev-agent
- dev-agent /events endpoint needed to receive and process these events (Plan 05)
- Pattern established for future GitHub event types (PR merged, issue events, etc.)

---
*Phase: 23-event-infrastructure*
*Completed: 2026-01-25*
