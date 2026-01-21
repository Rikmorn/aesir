---
phase: 17-github-extraction
plan: 03
subsystem: integrations
tags: [github, webhooks, zod, octokit, signature-verification]

# Dependency graph
requires:
  - phase: 17-01
    provides: GitHub package scaffolding
provides:
  - Webhook signature verification using @octokit/webhooks-methods
  - Zod schemas for PR review webhook payloads
  - parsePRReviewPayload function for safe payload parsing
affects: [17-04-webhook-routes, agents-github-integration]

# Tech tracking
tech-stack:
  added: ["@octokit/webhooks-methods"]
  patterns: ["Timing-safe signature verification", "Zod SafeParseReturnType for controlled error handling"]

key-files:
  created:
    - packages/integrations/github/src/webhooks/signature.ts
    - packages/integrations/github/src/webhooks/types.ts
    - packages/integrations/github/src/webhooks/parser.ts
    - packages/integrations/github/src/webhooks/index.ts
  modified: []

key-decisions:
  - "Use @octokit/webhooks-methods for GitHub signature verification (timing-safe, handles sha256= prefix)"
  - "Conditional property assignment for exactOptionalPropertyTypes compliance"
  - "Follow Linear pattern for webhook payload parsing with SafeParseReturnType"

patterns-established:
  - "verifyWebhookRequest helper extracts metadata (deliveryId, eventType) along with verification"
  - "parsePRReviewPayload returns SafeParseReturnType for controlled error handling"
  - "Synthetic ZodError for JSON parse failures"

# Metrics
duration: 1min
completed: 2026-01-21
---

# Phase 17 Plan 03: Webhook Verification and Parsing Summary

**GitHub webhook signature verification with @octokit/webhooks-methods and Zod schemas for PR review payloads**

## Performance

- **Duration:** 1 min 33 sec
- **Started:** 2026-01-21T20:39:43Z
- **Completed:** 2026-01-21T20:41:16Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- GitHub-specific signature verification using @octokit/webhooks-methods (timing-safe)
- Webhook type definitions: GitHubWebhookHeaders, GitHubWebhookEvent, WebhookPayloadBase
- Zod schemas moved from agents package: PullRequestSchema, ReviewSchema, RepositorySchema, PRReviewPayloadSchema
- Safe payload parsing with parsePRReviewPayload function

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook signature verification** - `c9374e3` (feat)
2. **Task 2: Create webhook payload parser with Zod schemas** - `840348a` (feat)

## Files Created/Modified
- `packages/integrations/github/src/webhooks/signature.ts` - verifySignature and verifyWebhookRequest using @octokit/webhooks-methods
- `packages/integrations/github/src/webhooks/types.ts` - GitHubWebhookHeaders, GitHubWebhookEvent, WebhookPayloadBase interfaces
- `packages/integrations/github/src/webhooks/parser.ts` - Zod schemas and parsePRReviewPayload function
- `packages/integrations/github/src/webhooks/index.ts` - Barrel export for all webhook modules

## Decisions Made

1. **Use @octokit/webhooks-methods for signature verification**
   - Rationale: Official Octokit library handles X-Hub-Signature-256 with sha256= prefix automatically, provides timing-safe comparison
   - Alternative: Manual crypto.timingSafeEqual like Linear (rejected for GitHub-specific handling)

2. **Conditional property assignment for exactOptionalPropertyTypes**
   - Rationale: TypeScript strictness requires explicit undefined checks when assigning optional properties
   - Pattern: Build result object conditionally, only assign properties when value !== undefined

3. **Follow Linear pattern for webhook parsing**
   - Rationale: Consistent approach across integrations, SafeParseReturnType provides controlled error handling
   - Pattern: Try JSON.parse, return synthetic ZodError on failure, then safeParse with schema

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - straightforward implementation following established patterns from Linear integration.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Webhook infrastructure ready for HTTP route implementation (17-04)
- Signature verification and payload parsing available for webhook handler
- No blockers for next plan

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
