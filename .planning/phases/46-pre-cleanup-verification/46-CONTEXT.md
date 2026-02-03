# Phase 46: Pre-Cleanup Verification & Dependency Audit - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that the v2.3 executor cutover is complete and produce a verified deletion manifest for Phase 47. The original Phase 46 scope (feature flag + Temporal drain period) is obsolete -- Phase 44 already cut over completely. This phase is redefined as a pre-cleanup verification gate.

Phase 46 does NOT delete code or remove dependencies. It audits, verifies boundaries, validates the running system, and produces the ordered deletion manifest that Phase 47 executes.

</domain>

<decisions>
## Implementation Decisions

### Scope redefinition
- Original scope (feature flag routing + 7-day Temporal drain) is already done via Phase 44
- No `USE_V23_EXECUTOR` feature flag needed -- v2.3 is the only active code path
- No Temporal workflows to drain -- Temporal services removed from Docker Compose in Phase 44
- Redefined as: five-area pre-cleanup verification gate before Phase 47 starts deleting code
- ROADMAP.md should be updated to reflect the new phase name and scope

### Five verification areas
1. **Dependency audit** -- Map every `@temporalio/*` import, confirm no live code path touches Temporal. Check for transitive dependencies.
2. **Dead code boundary mapping** -- Enumerate files/directories for deletion with verified boundaries. Identify barrel exports, re-exports, and shared types that cross the live/dead boundary.
3. **Docker Compose validation** -- Automated script + manual checklist. Boot current compose, verify health, process test event, tear down.
4. **Database migration audit** -- Code-level grep for old table references (`tasks`, `context_snapshots`, `execution_traces`). Confirm no active writers. Identify tables safe to drop.
5. **Package.json audit** -- Check scripts, bin entries, and config referencing old service entry points or Temporal. Verify `pnpm typecheck` and `pnpm lint` pass.

### Deletion manifest
- Phase 46 produces a concrete `46-DELETION-MANIFEST.md` with:
  - Ordered list of files/directories to delete
  - References to refactor before deletion (barrel exports, re-exports, type imports)
  - Tables to drop
  - Dependencies to remove from package.json
  - Deletion order matters -- refactor references first, then delete orphaned files
  - Phase 47 executes against this manifest with typecheck/lint gates between steps

### Docker Compose validation approach
- **Automated script**: Bash script that runs `docker compose up`, waits for health endpoint, posts a test event, verifies response, tears down. Repeatable for CI or local use.
- **Manual checklist**: Documented steps for human QA validation. Serves as a manual testing guide beyond Phase 45's E2E checklist. Both outputs produced.

### Database audit depth
- Code-level: grep for references to old table names in active code
- Confirm old tables have no active writers in v2.3 code paths
- Goal: ensure Phase 47 can safely drop old tables and no redundant tables remain

### Extra scrutiny areas (per user concern)
- **Router module integrity**: Phase 43 adapted the router in-place. Re-verify no Temporal references leaked back in. Check conditional imports, fallback paths, or commented-out Temporal code.
- **Test breakage analysis**: Document exactly when Phase 47 deletions could break tests:
  - Skipped Temporal tests (168 in 6 files) -- safe to delete, but deletion order matters
  - Barrel export chains that re-export from `shared/temporal/`
  - Type dependencies flowing from Temporal files into v2.3 code
  - Test utilities (`@aesir/test-utils`) that reference Temporal mocks/factories
  - Router adaptation completeness (no lingering Temporal fallbacks)
- **Phase 47 guidance**: Manifest should encode safe deletion order and recommend typecheck gates between deletion steps

### Claude's Discretion
- Database audit can be code-level only (no need to spin up PostgreSQL and query data) -- it's not a production DB
- Automated Docker Compose script implementation details (wait strategy, timeout values, assertion approach)
- Manifest format and organization

</decisions>

<specifics>
## Specific Ideas

- Phase 47 cleanup should not be "flat out deleting files" -- it's refactoring to remove dead references first, then deleting orphaned files. The manifest encodes this order.
- Phase 47 should also do its own verification checks after each deletion step (typecheck/lint gates)
- The deletion manifest is the key deliverable -- it bridges Phase 46 (verify) and Phase 47 (execute)
- Docker validation serves dual purpose: confirms Phase 44 consolidation works as a real deployment AND provides a QA checklist for ongoing manual testing

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 46-pre-cleanup-verification*
*Context gathered: 2026-02-03*
