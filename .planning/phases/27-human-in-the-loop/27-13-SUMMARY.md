---
phase: 27-human-in-the-loop
plan: 13
subsystem: integrations
tags: [linear, webhooks, comments, approval, hitl, zod]

# Dependency graph
requires:
  - phase: 27-01
    provides: classifyApprovalIntent for LLM-based approval classification
  - phase: 16-linear-extraction
    provides: Linear integration package structure and dispatcher pattern
provides:
  - Linear comment webhook parsing with Zod validation
  - Comment event normalization to NormalizedEvent format
  - Dispatch route for linear.comment.created to dev-agent
affects: [dev-agent, approval-workflow, hitl]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Multi-event webhook handler (Comment alongside AgentSession)

key-files:
  created: []
  modified:
    - packages/integrations/linear/src/webhooks/parser.ts
    - packages/integrations/linear/src/dispatcher/normalize.ts
    - packages/integrations/linear/src/dispatcher/routes.ts
    - packages/integrations/linear/src/api/webhooks.ts

key-decisions:
  - "Direct type check (basicPayload.type === 'Comment') over type guard for partial payload"
  - "Comment body dispatched raw - dev-agent handles classification via classifyApprovalIntent"

patterns-established:
  - "Multi-event webhook handler: Route by type before validation"
  - "Comment event uses linear.comment.created event type"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 27 Plan 13: Linear Comment Webhook Handler Summary

**Linear comment webhook handler for approval intent classification via HITL-03**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T22:40:45Z
- **Completed:** 2026-01-27T22:43:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Linear Comment webhook payload parsing with Zod validation
- Comment body captured for LLM approval intent classification
- Events dispatched to dev-agent via linear.comment.created route
- Webhook handler extended to support multiple event types

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Linear comment payload parser** - `e97fcff` (feat)
2. **Task 2: Add comment event normalization and dispatch** - `ee90db2` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/webhooks/parser.ts` - Added CommentPayloadSchema, parseCommentPayload, isCommentEvent
- `packages/integrations/linear/src/dispatcher/normalize.ts` - Added normalizeCommentCreatedEvent function
- `packages/integrations/linear/src/dispatcher/routes.ts` - Added linear.comment.created route to dev-agent
- `packages/integrations/linear/src/api/webhooks.ts` - Refactored to handle Comment events alongside AgentSession

## Decisions Made
- **Direct type check over type guard:** Used `basicPayload.type === 'Comment'` rather than type guard function because the initial JSON parse produces a partial object without all WebhookPayloadBase fields. This is cleaner than casting.
- **Raw comment body dispatch:** Comment body is dispatched as-is to dev-agent, where `classifyApprovalIntent` (from 27-01) handles the LLM classification. This separates concerns: Linear integration handles transport, dev-agent handles intelligence.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Linear comment events now flow to dev-agent for approval classification
- Completes HITL-03 (Linear comment approval) infrastructure
- Ready for end-to-end testing with approval workflow

---
*Phase: 27-human-in-the-loop*
*Completed: 2026-01-27*
