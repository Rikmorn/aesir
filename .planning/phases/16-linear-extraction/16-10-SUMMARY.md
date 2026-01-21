---
phase: 16-linear-extraction
plan: 10
subsystem: integrations
tags: [linear, monorepo, workspace, backward-compatibility, re-exports, migration]

# Dependency graph
requires:
  - phase: 16-06
    provides: "@aesir/integration-linear package with credential store integration"
  - phase: 16-07
    provides: "Database migration from shared to Linear-specific schema"
  - phase: 16-08
    provides: "Docker service deployment and documentation"
  - phase: 16-09
    provides: "Test migration and validation"
provides:
  - Agents package imports directly from @aesir/integration-linear
  - Old integrations/linear/ location re-exports for backward compatibility
  - Clean migration path without breaking existing imports
affects: [17-github-extraction, 18-slack-extraction]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-export pattern for backward compatibility during package extraction"
    - "Biome override pattern for disabling organizeImports on specific files"
    - "_legacy/ directory for preserving old source during migration"

key-files:
  created:
    - packages/integrations/src/linear/index.ts
    - packages/integrations/src/_legacy/linear/**
  modified:
    - packages/agents/package.json
    - packages/integrations/package.json
    - packages/agents/src/api/webhooks/linear-agent-session.ts
    - packages/agents/src/scripts/linear-oauth.ts
    - packages/agents/src/temporal/activities/linear-activities.ts
    - packages/agents/src/nodes/pickup-task.ts
    - packages/agents/src/product-agent/nodes/create-tasks.ts
    - packages/agents/src/dev-workflow-runner.ts
    - packages/integrations/src/index.ts
    - packages/integrations/tsconfig.json
    - biome.json

key-decisions:
  - "IssueStatus re-exported from @aesir/common (shared type, not Linear-specific)"
  - "Old Linear source preserved in _legacy/ for reference during migration"
  - "workspace:* protocol for internal package dependencies"
  - "Disable Biome organizeImports for integrations/src/index.ts (intentional section headers)"
  - "_legacy/ excluded from TypeScript compilation and Biome checks"

patterns-established:
  - "Package extraction pattern: new package + backward-compatible re-exports in old location"
  - "Biome overrides for intentional file organization with section headers"
  - "Project reference updates in tsconfig when adding new workspace dependencies"

# Metrics
duration: 7min
completed: 2026-01-21
---

# Phase 16 Plan 10: Consumer Migration Summary

**Agents package imports from @aesir/integration-linear directly, old location provides deprecated re-exports for backward compatibility**

## Performance

- **Duration:** 7 min (446 seconds)
- **Started:** 2026-01-21T19:19:01Z
- **Completed:** 2026-01-21T19:26:27Z
- **Tasks:** 2
- **Files modified:** 28 (11 direct, 17 in _legacy/)

## Accomplishments

- Updated all Linear imports in agents package to use @aesir/integration-linear
- Created backward-compatible re-export layer in integrations/src/linear/
- Preserved old source files in _legacy/ for reference
- All builds pass with new package structure

## Task Commits

Each task was committed atomically:

1. **Task 1: Update agents package to use new Linear package** - `487077b` (feat)
   - Added @aesir/integration-linear dependency to agents package.json
   - Updated Linear imports in webhook handlers, OAuth script, Temporal activities
   - Updated Linear imports in workflow nodes (pickup-task, create-tasks, dev-workflow-runner)
   - Updated test mocks to use new package path
   - Kept Temporal imports separate from Linear imports

2. **Task 2: Create backward-compatible re-exports** - `2e1061a` (refactor)
   - Added @aesir/integration-linear dependency to integrations package.json
   - Moved old Linear source to src/_legacy/linear/ for reference
   - Created new src/linear/index.ts that re-exports from @aesir/integration-linear
   - Updated main index.ts with @deprecated JSDoc for Linear section
   - Configured TypeScript and Biome to exclude _legacy/

## Files Created/Modified

**Created:**
- `packages/integrations/src/linear/index.ts` - Re-exports from @aesir/integration-linear with deprecation notice
- `packages/integrations/src/_legacy/linear/**` - Preserved old source files for reference (12 files)

**Modified (Agents):**
- `packages/agents/package.json` - Added @aesir/integration-linear workspace dependency
- `packages/agents/src/api/webhooks/linear-agent-session.ts` - Updated Linear webhook verification imports
- `packages/agents/src/scripts/linear-oauth.ts` - Updated saveLinearTokens import
- `packages/agents/src/temporal/activities/linear-activities.ts` - Updated updateIssueStatus import
- `packages/agents/src/nodes/pickup-task.ts` - Updated Linear activity imports
- `packages/agents/src/product-agent/nodes/create-tasks.ts` - Updated createIssue, listLabels imports
- `packages/agents/src/dev-workflow-runner.ts` - Updated emitError, updateIssueStatus imports
- Test files (3) - Updated mocks to use @aesir/integration-linear

**Modified (Integrations):**
- `packages/integrations/package.json` - Added @aesir/integration-linear workspace dependency
- `packages/integrations/src/index.ts` - Added @deprecated section for Linear re-exports
- `packages/integrations/tsconfig.json` - Excluded _legacy/, added integration-linear project reference

**Modified (Config):**
- `biome.json` - Added overrides for _legacy/ and integrations/src/index.ts

## Decisions Made

**1. IssueStatus from @aesir/common**
- IssueStatus is a shared type used across layers, not Linear-specific
- Re-exported from @aesir/common in both linear/index.ts and main index.ts
- Not part of @aesir/integration-linear package exports

**2. Preserve old source in _legacy/**
- Moved instead of deleted for reference during migration
- Excluded from compilation and linting to avoid errors
- Can be removed in future phase after migration stabilizes

**3. Disable organizeImports for integrations index**
- Biome's organizeImports would reorder sections, breaking intentional organization
- Added file-specific override to preserve section headers
- Maintains clear structure: Common → Platform → Credential → Errors → GitHub → Linear → Services → Slack

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. Biome organizeImports interference**
- **Problem:** Biome kept reordering exports, breaking section organization
- **Solution:** Added file-specific override in biome.json to disable organizeImports for integrations/src/index.ts
- **Result:** Section headers preserved, intentional organization maintained

**2. _legacy/ files causing lint errors**
- **Problem:** Old code has lint violations (noNonNullAssertion)
- **Solution:** Added override to disable linter and assist for **/_legacy/** pattern
- **Result:** Pre-commit hooks pass, _legacy/ files preserved for reference

## Next Phase Readiness

**Ready for GitHub and Slack extraction:**
- Pattern established: extract to new package + re-export in old location
- Biome configuration handles intentional organization and legacy files
- workspace:* dependency pattern validated

**Migration complete:**
- All Linear functionality migrated to standalone package
- Backward compatibility maintained via re-exports
- Agents package uses new package directly
- Tests pass, builds succeed

---
*Phase: 16-linear-extraction*
*Completed: 2026-01-21*
