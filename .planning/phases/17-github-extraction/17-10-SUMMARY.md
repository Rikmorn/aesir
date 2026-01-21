---
phase: 17-github-extraction
plan: 10
subsystem: integrations
tags: [github, monorepo, re-exports, backward-compatibility]

# Dependency graph
requires:
  - phase: 17-04
    provides: GitHub operations module
  - phase: 17-06
    provides: GitHub HTTP API routes
provides:
  - GitHub package with complete exports
  - Backward-compatible re-exports in @aesir/integrations
  - Legacy code preserved in _legacy/github/
affects: [future-github-integration-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-export pattern for backward compatibility during package extraction"
    - "_legacy/ directory pattern for preserving old code during migration"
    - "Deprecation notices in re-export wrapper files"

key-files:
  created:
    - packages/integrations/src/_legacy/github/README.md
  modified:
    - packages/integrations/github/src/index.ts
    - packages/integrations/src/index.ts
    - packages/agents/src/api/webhooks/github-pr-review.ts
    - packages/agents/src/api/webhooks/schemas/github-webhook.ts

key-decisions:
  - "GitHubConfig renamed to GitHubServiceConfig to avoid naming conflict with client config type"
  - "Removed verifyWebhookSignature from agents package (now in integration package)"
  - "Removed signature verification tests from agents (covered by integration package)"

patterns-established:
  - "Integration package exports complete API surface through barrel index.ts"
  - "Re-export deprecated APIs from @aesir/integrations for gradual migration"
  - "Move old source to _legacy/ with README documenting migration date"

# Metrics
duration: 6min
completed: 2026-01-21
---

# Phase 17 Plan 10: Consumer Migration Summary

**GitHub package exports complete, consumers migrated to new package, backward compatibility maintained via re-exports**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-21T21:00:50Z
- **Completed:** 2026-01-21T21:06:37Z
- **Tasks:** 2
- **Files modified:** 25

## Accomplishments
- GitHub package exports all modules through index.ts barrel
- Integrations package re-exports GitHub for backward compatibility
- Agents package updated to import from @aesir/integration-github
- Old GitHub source preserved in _legacy/github/ with documentation

## Task Commits

Each task was committed atomically:

1. **Task 1: Update GitHub package exports and integrations re-exports** - `919260a` (feat)
2. **Task 2: Update agents to use GitHub package and preserve legacy code** - `0079e15` (feat)

## Files Created/Modified

**Created:**
- `packages/integrations/src/_legacy/github/README.md` - Migration documentation

**Modified:**
- `packages/integrations/github/src/index.ts` - Complete barrel exports
- `packages/integrations/github/src/types/config.ts` - Renamed GitHubConfig to GitHubServiceConfig
- `packages/integrations/src/index.ts` - Re-exports from @aesir/integration-github
- `packages/integrations/package.json` - Added @aesir/integration-github dependency
- `packages/agents/src/api/webhooks/github-pr-review.ts` - Import from @aesir/integration-github
- `packages/agents/src/api/webhooks/schemas/github-webhook.ts` - Deprecation notice and re-exports
- `packages/agents/src/api/webhooks/index.ts` - Removed verifyWebhookSignature export
- `packages/agents/src/api/webhooks/github-pr-review.test.ts` - Removed signature tests
- `packages/agents/package.json` - Added @aesir/integration-github dependency

**Moved:**
- `packages/integrations/src/github/*` → `packages/integrations/src/_legacy/github/*` (11 files)

## Decisions Made

**1. GitHubConfig naming conflict resolution**
- **Issue:** Two `GitHubConfig` types existed (service config and client config)
- **Decision:** Renamed service config to `GitHubServiceConfig`
- **Rationale:** Client config is the public API type, service config is internal

**2. Removed duplicate signature verification**
- **Issue:** Agents had local `verifyWebhookSignature` implementation
- **Decision:** Use `verifySignature` from @aesir/integration-github
- **Rationale:** Single source of truth for signature verification logic

**3. Removed signature verification tests from agents**
- **Issue:** Tests duplicated integration package tests
- **Decision:** Remove from agents, rely on integration package tests
- **Rationale:** Low-level signature verification is integration package responsibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed GitHubConfig naming conflict**
- **Found during:** Task 1 (Building GitHub package)
- **Issue:** Two types named `GitHubConfig` caused TypeScript export ambiguity error
- **Fix:** Renamed service config type to `GitHubServiceConfig` to distinguish from client config
- **Files modified:** `packages/integrations/github/src/types/config.ts`
- **Verification:** TypeScript compilation succeeds
- **Committed in:** 919260a (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added package dependencies**
- **Found during:** Task 1 and Task 2 (Building packages)
- **Issue:** Re-exports required adding workspace dependencies to package.json
- **Fix:** Added @aesir/integration-github to integrations and agents packages
- **Files modified:** `packages/integrations/package.json`, `packages/agents/package.json`
- **Verification:** pnpm install succeeds, TypeScript imports resolve
- **Committed in:** 919260a, 0079e15 (respective task commits)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for compilation. Naming conflict was discovered during extraction. Package dependencies required for imports.

## Issues Encountered

None - plan executed smoothly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

GitHub extraction complete. Ready for:
- Phase 17-11: Deployment configuration and final documentation
- Future phases using GitHub integration can import from @aesir/integration-github
- Old code preserved in _legacy/ for reference during transition

---
*Phase: 17-github-extraction*
*Completed: 2026-01-21*
