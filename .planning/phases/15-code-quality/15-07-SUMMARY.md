---
phase: 15-code-quality
plan: 07
subsystem: integrations
tags: [neverthrow, result-type, error-handling, webhook, sync-cursor, gap-closure]

# Dependency graph
requires:
  - phase: 15-02
    provides: "CredentialStore ResultAsync pattern"
  - phase: 15-03
    provides: "ExecutionTracker ResultAsync pattern, health/close remain Promise-based"
provides:
  - IntegrationServiceError class for service boundary errors
  - WebhookIdempotencyService.checkAndRecord returns ResultAsync
  - SyncCursorService.get/set/clear return ResultAsync
  - linear-agent-session.ts handles ResultAsync from checkAndRecord
affects: [future-integration-services, webhook-handlers, sync-operations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service boundary methods return ResultAsync<T, IntegrationServiceError>"
    - "Lifecycle methods (health/close) remain Promise-based"
    - "Extract implementation to private function, wrap with fromPromise"
    - "Best-effort error handling in consumers (log warning, continue)"

key-files:
  created:
    - packages/integrations/src/errors/integration-errors.ts (IntegrationServiceError)
  modified:
    - packages/integrations/src/services/webhook-idempotency.ts
    - packages/integrations/src/services/sync-cursor.ts
    - packages/agents/src/api/webhooks/linear-agent-session.ts
    - packages/integrations/src/errors/index.ts
    - packages/integrations/src/index.ts

key-decisions:
  - "IntegrationServiceError separate from CredentialError (semantic clarity)"
  - "Idempotency check failures are best-effort (don't block webhook processing)"
  - "health() and close() remain Promise-based (lifecycle, not service boundaries)"

patterns-established:
  - "fromPromise wrapper with extracted impl functions for service methods"
  - "INT_SVC_* error code prefix for integration service errors"
  - "Best-effort error handling pattern: isErr() → log warning, continue"

# Metrics
duration: 7min
completed: 2026-01-21
---

# Phase 15 Plan 07: Service Boundaries Gap Closure Summary

**WebhookIdempotencyService and SyncCursorService migrated to ResultAsync pattern with IntegrationServiceError**

## Performance

- **Duration:** 7 min (443 seconds)
- **Started:** 2026-01-21T16:09:51Z
- **Completed:** 2026-01-21T16:17:14Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Created IntegrationServiceError class for service boundary errors
- Migrated WebhookIdempotencyService.checkAndRecord to ResultAsync
- Migrated SyncCursorService.get/set/clear to ResultAsync
- Updated linear-agent-session.ts to handle ResultAsync from idempotency check
- Closed QUAL-01 gap for Phase 15 verification

## Task Commits

Each task was committed atomically:

1. **Task 0: Fix blocking build issue** - `942c08a` (fix)
   - [Rule 1 - Bug] Moved @langchain/core from devDependencies to dependencies
   - Platform package exports mock-llm.ts which imports from @langchain/core
   - TypeScript couldn't resolve module, blocking all commits
   - Required to proceed with plan execution

2. **Task 1: Create IntegrationServiceError** - `183aaa7` (feat)
   - Added IntegrationServiceErrorCode type (DATABASE, NOT_FOUND, DUPLICATE)
   - Created IntegrationServiceError class extending AppError
   - Exported from errors/index.ts and package index.ts
   - Follows same pattern as CredentialError

3. **Task 2: Migrate WebhookIdempotencyService** - `664ff5a` (feat)
   - Changed checkAndRecord to return ResultAsync
   - Extracted implementation to checkAndRecordImpl private function
   - Wrapped with fromPromise for error handling
   - Updated linear-agent-session.ts consumer to handle ResultAsync
   - Idempotency failures are best-effort (log warning, continue)

4. **Task 3: Migrate SyncCursorService** - `05af779` (feat)
   - Changed get/set/clear to return ResultAsync
   - Extracted implementations to private functions
   - Wrapped with fromPromise
   - No consumer updates needed (no consumers yet)

## Files Created/Modified

**Created:**
- `packages/integrations/src/errors/integration-errors.ts` - IntegrationServiceError class with INT_SVC_* error codes

**Modified:**
- `packages/integrations/src/services/webhook-idempotency.ts` - ResultAsync-based checkAndRecord
- `packages/integrations/src/services/sync-cursor.ts` - ResultAsync-based get/set/clear
- `packages/agents/src/api/webhooks/linear-agent-session.ts` - ResultAsync handling for idempotency
- `packages/integrations/src/errors/index.ts` - Export IntegrationServiceError
- `packages/integrations/src/index.ts` - Re-export IntegrationServiceError
- `packages/platform/package.json` - Move @langchain/core to dependencies (bug fix)

## Decisions Made

**1. IntegrationServiceError separate from CredentialError**
- Rationale: Webhook idempotency and sync cursors are general integration services, not credential-specific
- Keeps error types semantically meaningful
- Follows same pattern but different domain

**2. Idempotency check failures are best-effort**
- Rationale: Database glitch shouldn't prevent webhook processing
- Follows same pattern as ExecutionTracker from 15-03
- Log warning but continue processing

**3. health() and close() remain Promise-based**
- Rationale: Lifecycle methods, not service boundaries (per 15-03 decision)
- Consistent with CredentialStore, CleanupService, ExecutionTracker
- Only public service methods return ResultAsync

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed @langchain/core dependency placement**
- **Found during:** Task 1 (attempting to commit)
- **Issue:** Build was broken - pre-commit hook failing with TypeScript errors in packages/platform/src/testing/mock-llm.ts. @langchain/core was in devDependencies but mock-llm.ts is exported from the package and imports from @langchain/core at runtime. TypeScript module resolution failed.
- **Fix:** Moved @langchain/core from devDependencies to dependencies in packages/platform/package.json
- **Files modified:** packages/platform/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @aesir/platform build` passes, pre-commit hook succeeds
- **Committed in:** 942c08a (separate commit before Task 1)
- **Impact:** Required to unblock commit flow, no relation to 15-07 scope

---

**Total deviations:** 1 auto-fixed (1 blocking bug)
**Impact on plan:** Bug fix was unrelated to plan scope but required to proceed. Build was broken by incorrect dependency placement in platform package. No scope creep - restored working build state.

## Issues Encountered

**1. Linter auto-revert during failed commit**
- Problem: First commit attempt failed pre-commit hook. Biome auto-formatted files during commit, reverting my changes to exports.
- Resolution: Re-applied changes after fixing blocking bug

**2. TypeScript error with metadata field**
- Problem: SyncCursorKey type doesn't have index signature, can't be assigned to ErrorMetadata
- Resolution: Explicitly destructure key fields into metadata object

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Completed:**
- QUAL-01 gap closed - all integration services now use ResultAsync pattern
- WebhookIdempotencyService and SyncCursorService consistent with CredentialStore, ExecutionTracker, CleanupService
- Phase 15 verification complete - all service boundaries use Result<T, E>

**Ready for:**
- Phase 16+ can rely on consistent error handling across all integration services
- Future integration services can follow established pattern

**No blockers or concerns.**

---
*Phase: 15-code-quality*
*Completed: 2026-01-21*
