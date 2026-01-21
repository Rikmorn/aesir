---
phase: 17-github-extraction
plan: 05
subsystem: integrations
tags: [github, oauth, octokit, credential-store, neverthrow]

# Dependency graph
requires:
  - phase: 17-01
    provides: Package scaffolding and error types
  - phase: 17-02
    provides: Database layer and credential store
provides:
  - OAuth token management with database persistence
  - Client factory from database credentials
  - OAuth authorization URL builder
affects: [17-06, 17-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Token store functions return null for missing credentials (not throws)
    - Client factory throws GitHubError for missing credentials
    - Conditional property assignment for exactOptionalPropertyTypes
    - DEFAULT_OWNER constant for single-tenant deployments

key-files:
  created:
    - packages/integrations/github/src/oauth/token-store.ts
    - packages/integrations/github/src/oauth/flow.ts
    - packages/integrations/github/src/oauth/index.ts
    - packages/integrations/github/src/client/types.ts
    - packages/integrations/github/src/client/factory.ts
    - packages/integrations/github/src/client/index.ts
  modified: []

key-decisions:
  - "loadGitHubTokens returns null for missing credentials (allows graceful handling)"
  - "createGitHubClientFromDatabase throws for missing credentials (fail-fast at client creation)"
  - "DEFAULT_OWNER = 'default' for single-tenant deployments (matches Linear pattern)"
  - "32-byte random hex for OAuth state (CSRF protection)"
  - "Default scope 'repo,read:org' for GitHub OAuth"

patterns-established:
  - "OAuth flow pattern: token-store.ts for persistence, flow.ts for client creation"
  - "Minimal client factory created to unblock OAuth flow (from 17-04 work)"

# Metrics
duration: 3min
completed: 2026-01-21
---

# Phase 17 Plan 05: GitHub OAuth Flow Summary

**OAuth token persistence with database-backed credential store, client factory from stored credentials, and authorization URL builder**

## Performance

- **Duration:** 3 minutes
- **Started:** 2026-01-21T20:44:28Z
- **Completed:** 2026-01-21T20:47:28Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Token store functions for loading and saving OAuth tokens using ResultAsync
- Client factory creates Octokit instances from database credentials
- OAuth state generation using crypto.randomBytes for CSRF protection
- Authorization URL builder for GitHub OAuth flow

## Task Commits

Each task was committed atomically:

1. **Task 1: Create token store (load/save functions)** - `e951cde` (feat)
2. **Task 2: Create OAuth flow utilities** - `5e1c087` (feat)

## Files Created/Modified
- `packages/integrations/github/src/oauth/token-store.ts` - Load/save tokens with ResultAsync integration
- `packages/integrations/github/src/oauth/flow.ts` - Client factory from DB, OAuth state/URL generation
- `packages/integrations/github/src/oauth/index.ts` - Barrel export for OAuth module
- `packages/integrations/github/src/client/types.ts` - GitHubConfig and operation types
- `packages/integrations/github/src/client/factory.ts` - Octokit client factory
- `packages/integrations/github/src/client/index.ts` - Barrel export for client module

## Decisions Made

1. **Token load returns null vs throws**: loadGitHubTokens returns null for missing credentials to allow callers to handle gracefully, while createGitHubClientFromDatabase throws GitHubError for fail-fast behavior at client creation boundary.

2. **DEFAULT_OWNER constant**: Following Linear's DEFAULT_WORKSPACE_ID pattern, using "default" as owner identifier for single-tenant deployments.

3. **OAuth state generation**: 32-byte random hex (64 characters) using crypto.randomBytes for cryptographically secure CSRF protection.

4. **Default OAuth scope**: "repo,read:org" provides repository access and org membership reading, typical for development workflow automation.

5. **exactOptionalPropertyTypes handling**: Conditional property assignment pattern with any-typed intermediate object to satisfy TypeScript strict optional property checks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created minimal client factory to unblock OAuth flow**
- **Found during:** Task 1 (Token store implementation)
- **Issue:** Plan 17-05 depends on 17-01 and 17-02, but client factory (createGitHubClient) is created in 17-04. Plan dependency was incomplete - should have included 17-04. Operations files already exist and import from client/types.ts, causing build errors.
- **Fix:** Created minimal client/types.ts, client/factory.ts, and client/index.ts with GitHubConfig interface and createGitHubClient/getOctokit functions. Also added all operation types (BranchInfo, CommitInfo, PullRequestInfo, etc.) to satisfy existing operations files.
- **Files modified:** 
  - packages/integrations/github/src/client/types.ts
  - packages/integrations/github/src/client/factory.ts
  - packages/integrations/github/src/client/index.ts
- **Verification:** pnpm typecheck passes, all imports resolve
- **Committed in:** e951cde (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking issue)
**Impact on plan:** Necessary to unblock execution due to plan dependency ordering issue. Created minimal client module that 17-04 would have created anyway. No scope creep - all code matches plan 17-04 specifications exactly.

## Issues Encountered

**exactOptionalPropertyTypes compliance**: TypeScript's exactOptionalPropertyTypes flag requires conditional property assignment for optional fields. Solved with intermediate any-typed object and conditional assignment pattern, documented with biome-ignore comments.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

OAuth flow module complete and ready for HTTP routes (17-06):
- Token persistence functions available
- Client factory from database credentials ready
- OAuth authorization URL builder ready
- State generation for CSRF protection ready

No blockers for next phase.

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
