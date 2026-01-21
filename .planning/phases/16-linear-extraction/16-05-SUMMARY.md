---
phase: 16-linear-extraction
plan: 05
subsystem: oauth
tags: [linear, oauth, tokens, credential-store, database]

# Dependency graph
requires:
  - phase: 16-02
    provides: Linear credential store with encryption
  - phase: 16-04
    provides: LinearClient factory with token refresh
provides:
  - Token loading/saving functions using Linear's credential store
  - createLinearClientFromDatabase for database-backed client creation
  - Automatic token refresh persistence to database
  - CredentialNotFoundError with helpful recovery hints
affects: [16-06-oauth-http-api, 16-07-integration-point]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Database-backed OAuth token management
    - Automatic token refresh with persistence callback
    - ResultAsync error handling for token operations

key-files:
  created:
    - packages/integrations/linear/src/oauth/token-store.ts
    - packages/integrations/linear/src/oauth/flow.ts
    - packages/integrations/linear/src/oauth/index.ts
  modified:
    - packages/integrations/linear/src/index.ts

key-decisions:
  - "loadLinearTokens and saveLinearTokens use Linear's credential store directly"
  - "createLinearClientFromDatabase bridges credential store and client factory"
  - "Token refresh automatically persisted via onTokenRefresh callback"
  - "DEFAULT_WORKSPACE_ID = ws_default for single-tenant deployments"
  - "CredentialNotFoundError includes recovery hint for OAuth flow"

patterns-established:
  - "High-level OAuth functions load/save via credential store"
  - "Client creation from database uses onTokenRefresh for persistence"
  - "Conditional property assignment for exactOptionalPropertyTypes compatibility"

# Metrics
duration: 4min
completed: 2026-01-21
---

# Phase 16 Plan 05: OAuth Flow Module Summary

**Database-backed OAuth token storage with automatic refresh persistence using Linear's credential store**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-21T18:56:36Z
- **Completed:** 2026-01-21T19:00:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Token store functions (load/save) using Linear's credential store
- createLinearClientFromDatabase bridges database and client factory
- Automatic token refresh persisted to database via callback
- CredentialNotFoundError with helpful recovery instructions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create token store functions** - `87a5aa4` (feat)
2. **Task 2: Create OAuth flow helper and exports** - `4b88951` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/oauth/token-store.ts` - loadLinearTokens, saveLinearTokens, CredentialNotFoundError
- `packages/integrations/linear/src/oauth/flow.ts` - createLinearClientFromDatabase with refresh persistence
- `packages/integrations/linear/src/oauth/index.ts` - OAuth module exports
- `packages/integrations/linear/src/index.ts` - Added oauth module exports

## Decisions Made

**1. Token storage uses Linear's credential store directly**
- loadLinearTokens/saveLinearTokens call createLinearCredentialStore
- No intermediate layer - direct database access
- Rationale: Keep it simple, credential store is already well-designed

**2. createLinearClientFromDatabase bridges credential store and client factory**
- Loads tokens from database via loadLinearTokens
- Creates onTokenRefresh callback that persists via store.updateTokens
- Passes callback to createLinearClient for automatic refresh
- Rationale: Clean separation of concerns, reuses existing components

**3. DEFAULT_WORKSPACE_ID = "ws_default"**
- Hardcoded default for single-tenant MVP
- Consistent with platform's ws_default usage
- Rationale: Multi-tenancy will be added later if needed

**4. CredentialNotFoundError with recovery hint**
- Includes isRecoverable: true and helpful hint
- Message points to npm run linear-oauth
- Rationale: Better DX than generic "not found" error

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes compatibility**
- **Found during:** Task 1 (token-store.ts) and Task 2 (flow.ts)
- **Issue:** Direct assignment of optional properties with `| undefined` fails with exactOptionalPropertyTypes
- **Fix:** Conditional property assignment pattern - only assign if value !== undefined
- **Files modified:** token-store.ts (input object, config object), flow.ts (tokens object)
- **Verification:** Build and typecheck pass
- **Committed in:** 87a5aa4 and 4b88951

**2. [Rule 3 - Blocking] Added biome-ignore for database type mismatch**
- **Found during:** Task 1 and Task 2
- **Issue:** db is NodePgDatabase but credential store expects PostgresJsDatabase
- **Fix:** Type assertion with biome-ignore and explanatory comment
- **Files modified:** token-store.ts (2 occurrences), flow.ts (1 occurrence)
- **Verification:** Linting passes with justified ignores
- **Committed in:** 87a5aa4 and 4b88951

---

**Total deviations:** 2 auto-fixed (1 type compatibility, 1 type mismatch)
**Impact on plan:** Both auto-fixes necessary for type correctness with exactOptionalPropertyTypes. No scope creep.

## Issues Encountered

None - straightforward implementation connecting existing components.

## Next Phase Readiness

- OAuth token management ready for HTTP API (16-06)
- createLinearClientFromDatabase ready for integration point (16-07)
- Token refresh automatically persisted - no manual refresh logic needed
- Error handling with helpful recovery hints in place

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
