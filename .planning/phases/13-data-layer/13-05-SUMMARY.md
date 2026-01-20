---
phase: 13-data-layer
plan: 05
subsystem: integrations
tags: [linear, oauth, credentials, database, encryption]

# Dependency graph
requires:
  - phase: 13-04
    provides: credential-store with encryption (storeCredential, getCredentialByProvider, updateCredentialTokens)
provides:
  - Database-backed Linear token storage (loadLinearTokens, saveLinearTokens, createLinearClientFromDatabase)
  - Token refresh persistence to database
  - OAuth flow saves to database
  - CredentialNotFoundError for explicit error handling
affects: [linear-integration, agent-bootstrap, migration-scripts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Database credentials with file fallback during transition
    - Explicit type annotations for dynamic imports

key-files:
  created: []
  modified:
    - packages/integrations/src/linear/token-store.ts
    - packages/integrations/src/linear/index.ts
    - packages/agents/src/scripts/start-dev-agent.ts
    - packages/agents/src/scripts/linear-oauth.ts

key-decisions:
  - "Retain legacy file functions with @deprecated for migration support"
  - "Database-first with file fallback in OAuth flow during transition"
  - "Use Awaited<ReturnType<>> for type annotations on dynamic import results"

patterns-established:
  - "CredentialNotFoundError with explicit workspace context for debugging"
  - "Conditional object building for exactOptionalPropertyTypes compliance"

# Metrics
duration: 7min
completed: 2026-01-20
---

# Phase 13 Plan 05: Linear Integration Wiring Summary

**Linear integration now uses database-backed credential store with createLinearClientFromDatabase as primary API**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-20T23:25:57Z
- **Completed:** 2026-01-20T23:32:11Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Linear tokens now stored/loaded from integrations.credentials table
- Token refresh automatically persists to database
- OAuth flow saves credentials to database with file fallback
- Dev agent uses database credentials with env var fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Update token-store to use database** - `0a00447` (feat)
2. **Task 2: Update start-dev-agent to use database credentials** - `53d275a` (feat)
3. **Task 3: Update linear-oauth to save to database** - `672b95f` (feat)

## Files Created/Modified

- `packages/integrations/src/linear/token-store.ts` - Database-backed token storage with legacy file functions deprecated
- `packages/integrations/src/linear/index.ts` - Export new database functions alongside legacy
- `packages/agents/src/scripts/start-dev-agent.ts` - Use createLinearClientFromDatabase with CredentialNotFoundError handling
- `packages/agents/src/scripts/linear-oauth.ts` - Save tokens to database with file fallback

## Decisions Made

- **Retain legacy file functions:** Kept loadLinearTokensFromFile, saveLinearTokensToFile, createLinearClientFromFile with @deprecated for migration support
- **Database-first with fallback:** OAuth flow tries database first, falls back to file if DB unavailable (transition period)
- **Type annotations for dynamic imports:** Used `Awaited<ReturnType<typeof fn>>` pattern to fix noImplicitAnyLet errors in dynamic import contexts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed noImplicitAnyLet lint errors in start-dev-agent.ts**
- **Found during:** Task 2 (start-dev-agent update)
- **Issue:** Pre-existing `let linearClient;` and `let worker;` without type annotations caused biome errors
- **Fix:** Added explicit type annotations using `Awaited<ReturnType<typeof fn>>` pattern
- **Files modified:** packages/agents/src/scripts/start-dev-agent.ts
- **Verification:** biome check passes, typecheck passes
- **Committed in:** 53d275a (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Minimal - fixed pre-existing lint issues that blocked commit. No scope creep.

## Issues Encountered

- **exactOptionalPropertyTypes compatibility:** Required conditional object building instead of spreading optional properties that could be undefined
- **Pre-existing lint violations:** noNonNullAssertion warnings in script files are documented tech debt (per STATE.md), not addressed in this plan

## User Setup Required

**External services require manual configuration.** For database credential storage:
- `CREDENTIAL_ENCRYPTION_KEY` environment variable required (generate with: `openssl rand -hex 32`)
- Database must be running with integrations schema migrated

## Next Phase Readiness

- Linear integration fully wired to database credentials
- Phase 13 (Data Layer) complete - all plans executed
- Ready for Phase 14 (Error Handling)

---
*Phase: 13-data-layer*
*Completed: 2026-01-20*
