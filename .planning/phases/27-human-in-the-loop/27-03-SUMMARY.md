---
phase: 27-human-in-the-loop
plan: 03
subsystem: integrations
tags: [github, webhooks, pr-events, dispatcher, zod]

# Dependency graph
requires:
  - phase: 17-github-extraction
    provides: GitHub integration package with webhook infrastructure
  - phase: 23-event-infrastructure
    provides: NormalizedEvent type and dispatcher pattern
provides:
  - PR closed webhook parsing with merged/closed distinction
  - PR closed event normalization with branch name
  - Dispatch routes for github.pull_request.merged and github.pull_request.closed
affects: [27-completion-flow, 26-dev-agent-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Webhook action filtering for PR events (check action field before parsing)
    - Dual event type generation from single webhook (merged vs closed)

key-files:
  created: []
  modified:
    - packages/integrations/github/src/webhooks/parser.ts
    - packages/integrations/github/src/dispatcher/normalize.ts
    - packages/integrations/github/src/api/webhooks.ts
    - packages/integrations/github/src/dispatcher/routes.ts

key-decisions:
  - "Reuse RepositorySchema in PRClosedPayloadSchema for consistency"
  - "Event type distinguishes merged vs closed: github.pull_request.merged or github.pull_request.closed"
  - "Include branch name in normalized event for container cleanup identification"
  - "Add onPRClosed callback to WebhookRouterDeps for extensibility"

patterns-established:
  - "PR event handling: filter by action field before parsing full payload"
  - "Dual event types: single webhook action generates different event types based on payload state"

# Metrics
duration: 5min
completed: 2026-01-27
---

# Phase 27 Plan 03: PR Feedback Handler Summary

**GitHub PR closed webhook parsing with merged/closed distinction and dispatch to dev-agent**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-27T10:00:00Z
- **Completed:** 2026-01-27T10:05:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- PR closed webhook payload parsing with Zod validation
- Distinction between merged PRs and closed-without-merge
- Event normalization including branch name for cleanup identification
- Dispatch routes for both github.pull_request.merged and github.pull_request.closed

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PR closed payload parser** - `f539bed` (feat)
2. **Task 2: Add PR closed event normalization** - `654f743` (feat)
3. **Task 3: Handle PR closed in webhook router** - `5716caa` (feat)

## Files Created/Modified

- `packages/integrations/github/src/webhooks/parser.ts` - Added PRClosedPayloadSchema and parsePullRequestClosedPayload
- `packages/integrations/github/src/dispatcher/normalize.ts` - Added normalizePRClosedEvent function
- `packages/integrations/github/src/api/webhooks.ts` - Added pull_request event handling for action=closed
- `packages/integrations/github/src/dispatcher/routes.ts` - Added github.pull_request.closed route

## Decisions Made

- **Reuse RepositorySchema:** PRClosedPayloadSchema reuses existing RepositorySchema rather than duplicating, ensuring consistency across PR event types
- **Event type distinction:** Event type is determined by merged status (github.pull_request.merged if merged=true, github.pull_request.closed otherwise), matching existing route patterns
- **Branch name inclusion:** Branch name included in normalized event payload to enable container cleanup identification (branch name maps to container)
- **Optional callback:** Added onPRClosed callback to WebhookRouterDeps for extensibility, matching existing onPRReview pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PR closed/merged events now flow to dev-agent
- Ready for completion flow implementation (Linear status update, Slack notification, container cleanup)
- Existing github.pull_request.merged route already existed; now webhook handler actually dispatches these events

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
