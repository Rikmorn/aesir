---
phase: 16-linear-extraction
plan: 03
subsystem: integrations
tags: [linear, webhooks, zod, hmac, security]

# Dependency graph
requires:
  - phase: 16-01
    provides: Linear package scaffolding with types and env validation
provides:
  - Complete webhook handling module for Linear package
  - HMAC-SHA256 signature verification with timing-safe comparison
  - Zod-based payload validation for AgentSession events
  - Type guards for webhook event detection
affects: [16-04-linear-client, 16-05-linear-http]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HMAC-SHA256 webhook signature verification"
    - "Zod safeParse for controlled validation"
    - "Type guards for payload narrowing"

key-files:
  created:
    - packages/integrations/linear/src/webhooks/types.ts
    - packages/integrations/linear/src/webhooks/signature.ts
    - packages/integrations/linear/src/webhooks/parser.ts
    - packages/integrations/linear/src/webhooks/index.ts
  modified:
    - packages/integrations/linear/src/index.ts

key-decisions:
  - "Use timingSafeEqual for signature verification to prevent timing attacks"
  - "Return Zod SafeParseResult from parseAgentSessionPayload for controlled error handling"
  - "Include data field in AgentSessionSchema even though unused (matches WebhookPayloadBase contract)"

patterns-established:
  - "Webhook modules organized: types.ts, signature.ts, parser.ts, index.ts"
  - "Signature verification before payload parsing"
  - "Type guards for event type detection after validation"

# Metrics
duration: 4min
completed: 2026-01-21
---

# Phase 16 Plan 03: Linear Webhook Handling Summary

**Complete webhook processing with HMAC-SHA256 signature verification, Zod-based payload validation, and type guards for event detection**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-21T18:46:33Z
- **Completed:** 2026-01-21T18:50:15Z
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 1

## Accomplishments
- Webhook types module with AgentSessionPayload and activity content types
- HMAC-SHA256 signature verification using timing-safe comparison
- Zod schema for AgentSession payload validation with SafeParseResult
- Type guards for detecting AgentSession and Issue webhook events
- Complete webhook module exported from Linear package

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook types and signature verification** - `d1046f1` (feat)
2. **Task 2: Create webhook parser with Zod validation** - `d74d868` (feat)

## Files Created/Modified

**Created:**
- `packages/integrations/linear/src/webhooks/types.ts` - Webhook payload types and activity content interfaces
- `packages/integrations/linear/src/webhooks/signature.ts` - HMAC-SHA256 signature verification with timing-safe comparison
- `packages/integrations/linear/src/webhooks/parser.ts` - Zod schema validation and type guards
- `packages/integrations/linear/src/webhooks/index.ts` - Webhook module exports

**Modified:**
- `packages/integrations/linear/src/index.ts` - Added webhooks module export

## Decisions Made

**1. Timing-safe signature comparison**
- Used `timingSafeEqual` from node:crypto to prevent timing attacks
- Rationale: Standard security practice for HMAC verification

**2. Zod SafeParseResult return type**
- `parseAgentSessionPayload` returns Zod's SafeParseResult for controlled error handling
- Rationale: Allows callers to handle validation errors gracefully without exceptions

**3. Include data field in schema**
- AgentSessionSchema includes `data: z.unknown()` even though Linear uses `agentSession` field
- Rationale: AgentSessionPayload extends `Omit<WebhookPayloadBase, "type">` which includes data field

**4. Removed explicit return type annotation**
- parseAgentSessionPayload infers return type from Zod schema
- Rationale: Avoids exactOptionalPropertyTypes conflicts with optional creator field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed exactOptionalPropertyTypes type error**
- **Found during:** Task 2 (webhook parser implementation)
- **Issue:** Return type annotation conflicted with exactOptionalPropertyTypes for optional creator field
- **Fix:** Removed explicit return type annotation, let TypeScript infer from schema
- **Files modified:** packages/integrations/linear/src/webhooks/parser.ts
- **Verification:** Build and typecheck passed
- **Committed in:** d74d868 (Task 2 commit)

**2. [Rule 3 - Blocking] Fixed Biome import organization**
- **Found during:** Task 2 commit
- **Issue:** Pre-commit hook failed due to unorganized imports in index files
- **Fix:** Ran `pnpm biome check --write` to organize exports alphabetically
- **Files modified:** packages/integrations/linear/src/webhooks/index.ts, packages/integrations/linear/src/index.ts
- **Verification:** Pre-commit checks passed
- **Committed in:** d74d868 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for build to succeed. No scope changes.

## Issues Encountered

None - plan executed as specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for next phase:**
- Complete webhook handling module exported from Linear package
- Signature verification, payload validation, and type guards available
- Ready for Linear client implementation (16-04) and HTTP server (16-05)

**No blockers or concerns.**

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
