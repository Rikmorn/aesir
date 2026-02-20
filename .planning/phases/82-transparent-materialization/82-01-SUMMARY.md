---
phase: 82-transparent-materialization
plan: 01
subsystem: database, api
tags: [materialization, linear, drizzle, zod, mcp, sub-issues, workflow-states]

# Dependency graph
requires:
  - phase: 81-parallel-delegation
    provides: task_groups table, delegate_task/delegate_group tools
provides:
  - MaterializationAdapter interface (create/syncStatus/handleWebhook)
  - MaterializationConfigSchema Zod validator
  - MaterializationRecord type and DB table (agents.materialization_records)
  - Linear MCP create_issue parentId support for sub-issues
  - Linear MCP update_issue_status stateType resolution (team-agnostic)
affects: [82-02, 82-03, 82-04, 82-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [materialization-adapter-interface, state-type-resolution]

key-files:
  created:
    - packages/agents/src/shared/services/materialization/types.ts
    - packages/agents/src/shared/services/materialization/index.ts
    - packages/agents/src/shared/db/migrations/0018_add_materialization_records.sql
  modified:
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/integrations/linear/src/mcp/schemas.ts
    - packages/integrations/linear/src/mcp/tools/issues.ts

key-decisions:
  - "MaterializationAdapter interface uses explicit param types (not generic Record) for create/syncStatus/handleWebhook"
  - "stateType takes precedence over statusName when both provided in update_issue_status"
  - "materializationSyncStatusValues enum constrained to active/completed/failed in Drizzle schema"

patterns-established:
  - "Materialization adapter pattern: interface with create/syncStatus/handleWebhook for target-agnostic dispatch"
  - "State type resolution: resolve Linear workflow states by type (team-agnostic) rather than name (team-specific)"

requirements-completed: [MAT-05, MAT-06]

# Metrics
duration: 4min
completed: 2026-02-20
---

# Phase 82 Plan 01: Foundation Types and Linear MCP Extensions Summary

**MaterializationAdapter interface with Zod config schema, materialization_records DB table, and Linear MCP extensions for parentId sub-issues and stateType-based status resolution**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T22:53:21Z
- **Completed:** 2026-02-20T22:57:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Foundation MaterializationAdapter interface with create/syncStatus/handleWebhook methods enabling target-agnostic dispatch
- MaterializationConfigSchema (Zod) validating the locked config shape: { type: transparent, target: linear, properties }
- agents.materialization_records table with task_id PK, target, external_id, conversation_id, agent_id, config, sync_status
- Linear MCP create_issue extended with optional parentId for sub-issue creation
- Linear MCP update_issue_status extended with optional stateType for team-agnostic state resolution

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration + Drizzle schema + materialization types** - `04787c1` (feat)
2. **Task 2: Extend Linear MCP create_issue and update_issue_status** - `a4bf828` (feat)

## Files Created/Modified
- `packages/agents/src/shared/db/migrations/0018_add_materialization_records.sql` - Migration for materialization_records table with indexes
- `packages/agents/src/shared/db/schema.ts` - Added materializationRecords Drizzle table definition and type exports
- `packages/agents/src/shared/db/schema.drizzle.ts` - Added materializationRecords mirror for drizzle-kit migration tracking
- `packages/agents/src/shared/services/materialization/types.ts` - MaterializationAdapter interface, config schema, param/result types, record type
- `packages/agents/src/shared/services/materialization/index.ts` - Barrel export for all public materialization types
- `packages/integrations/linear/src/mcp/schemas.ts` - Added parentId to CreateIssueInputSchema, stateType to UpdateIssueStatusInputSchema with refine
- `packages/integrations/linear/src/mcp/tools/issues.ts` - handleCreateIssue passes parentId, handleUpdateIssueStatus resolves by stateType

## Decisions Made
- MaterializationAdapter interface uses explicit typed params (MaterializationCreateParams, MaterializationSyncStatusParams, MaterializationWebhookParams) rather than generic Record types -- provides compile-time safety for consumers
- stateType takes precedence over statusName when both are provided in update_issue_status -- stateType is the team-agnostic path used by materialization adapter
- Drizzle schema uses `{ enum: materializationSyncStatusValues }` for sync_status column to constrain valid values at the schema level
- WorkflowState type imported from @linear/sdk for explicit typing of targetState variable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome formatter required single-line formatting for priority enum chain and availableTypes spread -- fixed before commit
- Biome lint required explicit WorkflowState type annotation on `let targetState` to avoid noImplicitAnyLet -- imported type from @linear/sdk

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MaterializationAdapter interface ready for LinearMaterializationAdapter implementation (Plan 02)
- MaterializationConfigSchema ready for delegate_task schema extension (Plan 03)
- materialization_records table ready for correlation tracking (Plan 02)
- Linear MCP parentId and stateType ready for materialization adapter to use (Plan 02)
- Migration 0018 needs `pnpm db:migrate` before the adapter can insert records

## Self-Check: PASSED

- All 3 created files verified on disk
- Both task commits (04787c1, a4bf828) verified in git log

---
*Phase: 82-transparent-materialization*
*Completed: 2026-02-20*
