---
phase: 15-code-quality
plan: 04
subsystem: api
tags: [zod, validation, webhooks, linear, github, typescript]

# Dependency graph
requires:
  - phase: 15-01
    provides: ValidationError class in @aesir/common
  - phase: 15-03
    provides: Zod webhook schemas in packages/agents/src/api/webhooks/schemas/
provides:
  - Zod validation integrated into Linear webhook handler
  - Zod validation integrated into GitHub webhook handler
  - Structured 400 error responses with validation details
  - PRReviewPayload and AgentSessionPayload types from schemas
affects: [api, webhooks, testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safeParse for webhook validation returning structured errors"
    - "ValidationError for aggregated field failures"

key-files:
  created: []
  modified:
    - packages/agents/src/api/webhooks/linear-agent-session.ts
    - packages/agents/src/api/webhooks/github-pr-review.ts
    - packages/agents/src/scripts/start-dev-agent.ts

key-decisions:
  - "Validate after signature verification but before processing"
  - "Non-AgentSession webhooks ignored without validation error (graceful handling)"
  - "Keep PRReviewEvent as deprecated alias for backward compatibility"

patterns-established:
  - "Zod safeParse + ValidationError for webhook validation pattern"
  - "Signature verification before Zod validation order"

# Metrics
duration: 20min
completed: 2026-01-21
---

# Phase 15 Plan 04: Webhook Zod Validation Summary

**Zod validation integrated into Linear and GitHub webhook handlers with structured 400 error responses**

## Performance

- **Duration:** 20 min
- **Started:** 2026-01-21T13:00:00Z
- **Completed:** 2026-01-21T13:20:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Linear webhook handler validates payloads with Zod schema before processing
- GitHub webhook handler validates payloads with Zod schema before processing
- Invalid payloads return HTTP 400 with structured validation errors (code, message, details)
- Validation errors include all field failures (not fail-fast)
- Backward compatibility maintained with PRReviewEvent deprecated alias

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Zod schemas** - `9c50861` (feat) - Note: Committed in 15-03 plan
2. **Task 2: Integrate validation** - `ea2e06b` (feat)

Note: Task 1 schemas were created and committed as part of 15-03 plan (cross-plan work).

## Files Created/Modified
- `packages/agents/src/api/webhooks/linear-agent-session.ts` - Added Zod validation with parseAgentSessionPayload
- `packages/agents/src/api/webhooks/github-pr-review.ts` - Added Zod validation with parsePRReviewPayload
- `packages/agents/src/scripts/start-dev-agent.ts` - Updated to pass rawBody instead of pre-parsed body

## Decisions Made
- **Validate after signature verification:** Signature verification proves the webhook came from the expected source; Zod validation ensures the payload structure is correct. Both are needed.
- **Graceful handling of non-AgentSession webhooks:** Linear sends various webhook types. Non-AgentSession events are ignored with 200 response rather than validation error.
- **Keep PRReviewEvent as deprecated alias:** Existing tests use PRReviewEvent type. Marked as deprecated but kept for backward compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Handle ResultAsync from ExecutionTracker**
- **Found during:** Task 2 (Linear webhook integration)
- **Issue:** ExecutionTracker.start() returns ResultAsync, not Promise. Code was treating it as Promise<string>.
- **Fix:** Added proper Result handling with isOk()/isErr() checks and error logging
- **Files modified:** packages/agents/src/api/webhooks/linear-agent-session.ts
- **Verification:** Build and typecheck pass
- **Committed in:** ea2e06b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix was necessary for type correctness. No scope creep.

## Issues Encountered
- Schemas were already committed in 15-03 plan due to cross-task dependency. Acknowledged and proceeded with Task 2.
- Pre-existing test failures in github-pr-review.test.ts due to incorrect mocking of @aesir/integrations. These are pre-existing issues unrelated to this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Webhook validation complete with Zod schemas
- Pattern established for other API endpoints to follow
- Test mocking needs updating for @aesir/integrations (tracked in STATE.md)

---
*Phase: 15-code-quality*
*Completed: 2026-01-21*
