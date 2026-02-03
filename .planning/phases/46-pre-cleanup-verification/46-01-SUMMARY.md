---
phase: 46
plan: 01
subsystem: codebase-audit
tags: [temporal, dead-code, audit, deletion-manifest, dependency-analysis]
requires:
  - Phase 45 (integration testing complete)
provides:
  - Evidence-backed audit confirming zero Temporal in live code paths
  - Three-phase ordered deletion manifest for Phase 47
affects:
  - Phase 47 (executes against this manifest)
tech-stack:
  added: []
  patterns: [three-phase-deletion-with-gates]
key-files:
  created:
    - .planning/phases/46-pre-cleanup-verification/46-AUDIT-REPORT.md
    - .planning/phases/46-pre-cleanup-verification/46-DELETION-MANIFEST.md
  modified: []
key-decisions:
  - "router/fast-path.ts is entirely dead code -- both matchFastPath and executeFastPath only called by routeEventLegacy"
  - "trace-recorder.ts and cost-tracking.ts confirmed dead -- only imported by legacy orchestrators called exclusively by Temporal activities"
  - "shared/tools/toolkits.ts dead -- only imported by legacy orchestrators, v2.3 uses framework/tool-factories.ts"
  - "RouteResult type must be kept -- used by v2.3 routeViaAgentLoopV2"
  - "Delete before refactor risk mitigated by three-phase ordering with typecheck gates"
duration: ~8m
completed: 2026-02-03
---

# Phase 46 Plan 01: Five-Area Codebase Audit + Deletion Manifest Summary

Evidence-backed audit of 5 areas confirming zero @temporalio in live paths, mapping ~50+ dead files across 5 directories, and producing three-phase ordered deletion manifest with 31 steps and typecheck gates.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~8 minutes |
| Started | 2026-02-03T13:29:09Z |
| Completed | 2026-02-03T13:37:04Z |
| Tasks | 2/2 |
| Files created | 2 |

## Accomplishments

### Task 1: Five-Area Codebase Audit
- Mapped all 25 files with @temporalio imports -- every one confirmed dead
- Traced 7 barrel export chains crossing live/dead boundary with specific fix steps
- Confirmed old database tables (tasks, context_snapshots, execution_traces) have zero v2.3 writers
- Catalogued 7 @temporalio dependencies and 8 scripts for removal across 3 package.json files
- Verified router module integrity -- routeEvent() call chain is Temporal-free
- Identified router/fast-path.ts as entirely dead (key finding not in research)
- Identified trace-recorder.ts, cost-tracking.ts, toolkits.ts as dead via transitive analysis
- Ran pnpm typecheck (PASS) and pnpm lint (3 pre-existing errors, none Phase 46 related)

### Task 2: Three-Phase Deletion Manifest
- Phase A: 11 refactoring steps removing live-to-dead references
- Phase B: 12 deletion steps covering ~50+ files and 5 directories
- Phase C: 8 dependency/config cleanup steps including DROP TABLE migration
- Typecheck gates between each phase
- Phase 47 execution guidance with parallelization opportunities
- Test breakage analysis: ~300+ tests removed (all dead code)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Five-Area Codebase Audit | `a6a2f55` | 46-AUDIT-REPORT.md |
| 2 | Three-Phase Deletion Manifest | `8c51224` | 46-DELETION-MANIFEST.md |

## Files Created

- `.planning/phases/46-pre-cleanup-verification/46-AUDIT-REPORT.md` -- 472 lines, 5 audit areas with evidence
- `.planning/phases/46-pre-cleanup-verification/46-DELETION-MANIFEST.md` -- 739 lines, 31 steps in 3 phases

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| router/fast-path.ts is entirely deletable | Neither matchFastPath nor executeFastPath is called by v2.3 routeEvent. DETERMINISTIC_RULES references Temporal signals. The v2.3 EventRouter replaces this with YAML-based rules. |
| RouteResult type must survive cleanup | Used by routeViaAgentLoopV2 (live v2.3 slow path). Cannot be removed with other legacy types. |
| trace-recorder.ts + cost-tracking.ts are dead | Only called by legacy orchestrators via Temporal activities. v2.3 framework uses EventLog instead. |
| shared/tools/toolkits.ts is dead | Only imported by legacy dev-agent/product-agent orchestrators. v2.3 uses framework/tool-factories.ts which imports individual tools directly. |
| Three-phase order: refactor -> delete -> deps | Prevents build breakage. Phase A removes imports first, Phase B deletes safely, Phase C cleans dependencies. |
| Docker volume rename deferred | Changing DB credentials from "temporal" to "aesir" requires volume recreation. Documented as Phase C step with migration instructions. |

## Deviations from Plan

### Auto-discovered Items

**1. [Additional Finding] router/fast-path.ts entirely dead**
- **Found during:** Task 1 (Area 2 audit)
- **Issue:** Research document was uncertain whether matchFastPath needed to survive. Audit confirmed it is only called by routeEventLegacy (dead).
- **Impact:** Simplified manifest -- entire file can be deleted rather than partially refactored.

**2. [Additional Finding] shared/tools/toolkits.ts dead code**
- **Found during:** Task 1 (Area 2 audit)
- **Issue:** TraceRecorderCallbacks import chain traced through to discovery that toolkits.ts is only imported by legacy orchestrators, not by v2.3 framework.
- **Impact:** Added step B12 to deletion manifest for toolkits cleanup.

**3. [Additional Finding] RouteResult type must be preserved**
- **Found during:** Task 2 (writing manifest)
- **Issue:** Initial audit classified RouteResult as legacy. Deeper analysis found routeViaAgentLoopV2 uses it.
- **Impact:** Corrected manifest step A2 to keep RouteResult in types.ts.

## Issues Encountered

None. All audit areas completed without blockers. Pre-existing lint errors (3) documented but not introduced by this phase.

## Next Phase Readiness

Phase 47 can execute immediately against the deletion manifest. No blockers or prerequisites remain.

**Prerequisites verified:**
- typecheck passes
- lint has only pre-existing errors
- All dead code boundary mapped
- All barrel export chains identified with fix steps
- Manifest provides executable ordered plan with gates

**Risks for Phase 47:**
- tsconfig may typecheck dead files (toolkits.ts) after their dependencies are deleted -- manifest accounts for this with step B12
- Docker credential rename requires volume recreation -- documented in step C4
