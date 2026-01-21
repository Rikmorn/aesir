---
phase: 16-linear-extraction
plan: 04
subsystem: integrations
tags: [linear, sdk, oauth, webhook, agent-activities]

# Dependency graph
requires:
  - phase: 16-01
    provides: Linear package scaffolding with env validation and error types
provides:
  - Linear client factory with OAuth token management
  - Issue operations (read, create, update status, list teams/labels)
  - Agent activity emitters (thought, action, response, error, elicitation)
affects: [16-05, 16-06, agents]

# Tech tracking
tech-stack:
  added: []
  patterns: [LinearOAuthConfig for token management, client factory pattern]

key-files:
  created:
    - packages/integrations/linear/src/client/factory.ts
    - packages/integrations/linear/src/client/types.ts
    - packages/integrations/linear/src/client/issues.ts
    - packages/integrations/linear/src/client/activities.ts
    - packages/integrations/linear/src/client/index.ts
  modified:
    - packages/integrations/linear/src/index.ts
    - packages/integrations/linear/src/webhooks/parser.ts
    - packages/integrations/linear/src/webhooks/types.ts

key-decisions:
  - "Renamed LinearConfig to LinearOAuthConfig to avoid naming conflict with env config type"
  - "Made WebhookPayloadBase.data optional (not all webhook types use it)"
  - "Added explicit | undefined to optional types for exactOptionalPropertyTypes compatibility"

patterns-established:
  - "Client factory pattern: createLinearClient with token refresh, getLinearClient for direct access"
  - "Token refresh with 60-second buffer before expiration"
  - "Automatic detection of token type (lin_api_ prefix for API keys vs OAuth tokens)"

# Metrics
duration: 6min
completed: 2026-01-21
---

# Phase 16 Plan 04: SDK Client Migration Summary

**Linear SDK client with OAuth token management, issue operations, and agent activity emitters**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-21T18:46:31Z
- **Completed:** 2026-01-21T18:52:34Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- LinearClient factory with automatic OAuth token refresh
- Complete issue management (create, read, update status, list teams/labels)
- Agent activity emitters for Linear UI integration
- Fixed exactOptionalPropertyTypes compatibility in webhook parser

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Linear client factory and types** - `1d2532e` (fix/feat - combined with bug fix)
2. **Task 2: Create issue operations and agent activities** - `0ee8934` (feat)

## Files Created/Modified

### Created
- `packages/integrations/linear/src/client/factory.ts` - Client factory with OAuth token management
- `packages/integrations/linear/src/client/types.ts` - LinearOAuthConfig type definition
- `packages/integrations/linear/src/client/issues.ts` - Issue CRUD operations (create, read, update, list)
- `packages/integrations/linear/src/client/activities.ts` - Agent activity emitters for Linear UI
- `packages/integrations/linear/src/client/index.ts` - Client module exports

### Modified
- `packages/integrations/linear/src/index.ts` - Added client module exports
- `packages/integrations/linear/src/webhooks/parser.ts` - Fixed schema for exactOptionalPropertyTypes
- `packages/integrations/linear/src/webhooks/types.ts` - Made optional fields explicit with | undefined

## Decisions Made

1. **Renamed LinearConfig to LinearOAuthConfig**: The types/config.ts file already exported a `LinearConfig` type for environment configuration. Renamed the OAuth token config to avoid naming conflict.

2. **Made WebhookPayloadBase.data optional**: AgentSession webhooks don't use the `data` field (they use `agentSession` instead). Made it optional in the base interface to handle different webhook types.

3. **Added explicit | undefined to optional types**: With exactOptionalPropertyTypes enabled, optional fields that may be undefined need explicit `| undefined` in their type definition. Applied to `AgentSessionPayload.agentSession.creator` and `WebhookPayloadBase.data`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes compatibility in webhook parser**
- **Found during:** Task 1 (commit attempt)
- **Issue:** TypeScript 2375 error - Zod schema inference incompatible with AgentSessionPayload type when exactOptionalPropertyTypes is enabled. The schema inferred `creator?: { id: string } | undefined` but the type had `creator?: { id: string }`.
- **Fix:**
  - Made `WebhookPayloadBase.data` optional (not all webhook types use it)
  - Added explicit `| undefined` to `AgentSessionPayload.agentSession.creator`
  - Added `data: z.unknown()` field to AgentSessionSchema for type compatibility
- **Files modified:**
  - packages/integrations/linear/src/webhooks/types.ts
  - packages/integrations/linear/src/webhooks/parser.ts
- **Verification:** `pnpm --filter @aesir/integration-linear typecheck` passed
- **Committed in:** 1d2532e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Bug fix was necessary to proceed with commit. No scope creep - fixed type compatibility issue from plan 16-03.

## Issues Encountered

None - plan executed smoothly after bug fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Linear client layer complete and ready for use by agents
- Issue operations fully functional (create, read, update status, list teams/labels)
- Agent activity emitters ready for integration with agent workflows
- Ready for plan 16-05 (HTTP handlers) and 16-06 (OAuth flow)

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
