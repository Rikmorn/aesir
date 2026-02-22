# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.9 Platform Completion -- Phase 84 (Scheduled Execution)

## Current Position

Phase: 84 of 87 (Scheduled Execution)
Plan: 1 of 3 in current phase
Status: Executing
Last activity: 2026-02-22 -- Completed 84-01 (schedule foundation)

Progress: [##########] 100%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |
| v2.3 Unified Agent Framework | 2026-02-04 | 12 | 32 |
| v2.4 Operations Dashboard | 2026-02-05 | 8 | 22 |
| v2.5 Agentic Conversations | 2026-02-08 | 7 | 17 |
| v2.6 Unified Agent Communication | 2026-02-09 | 7 | 16 |
| v2.7 Agent Collaboration | 2026-02-13 | 7 | 26 |
| v2.8 Resilience and Observability | 2026-02-18 | 6 | 22 |

## Performance Metrics

**Cumulative:**
- Total milestones shipped: 10
- Total phases completed: 80
- Total plans completed: 356

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 80 | 01 | 6min | 2 | 8 |
| 80 | 02 | 4min | 2 | 6 |
| 80 | 03 | 2min | 2 | 6 |
| 80 | 04 | 6min | 2 | 6 |
| 80 | 05 | 2min | 2 | 2 |
| 81 | 01 | 7min | 2 | 7 |
| 81 | 02 | 10min | 2 | 5 |
| 81 | 03 | 6min | 2 | 4 |
| 81 | 04 | 4min | 2 | 4 |
| 81 | 05 | 2min | 2 | 5 |
| 81 | 06 | 4min | 2 | 8 |
| 82 | 01 | 4min | 2 | 7 |
| 82 | 02 | 1min | 1 | 2 |
| 82 | 03 | 4min | 2 | 4 |
| 82 | 04 | 5min | 2 | 3 |
| 82 | 05 | 8min | 2 | 11 |
| 84 | 01 | 9min | 2 | 8 |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.

- **80-01**: Discriminated union on 'type' field for task:respond (accept/reject/counter_propose)
- **80-01**: Counter-propose auto-enters wait_for on target side (30s timeout)
- **80-01**: Auto-acceptance: wait_for_task on counter_proposed task sends acceptance implicitly
- **80-03**: Same negotiation text for all three agents -- generic principles, no role-specific calibration
- **80-03**: No MUST/ALWAYS/NEVER directives in negotiation guidance -- judgment-oriented per PROMPT_GUIDE.md
- **80-02**: Clarify auto-pauses with null timeout (task timeout is the universal bound)
- **80-02**: Answer auto-re-enters wait_for_task with all 5 signal types to prevent CRITICAL-1 deadlock
- **80-04**: Both namespace and internal tool name formats in DELEGATION_TOOL_NAMES for robustness
- **80-04**: Fixed pre-existing tool_name property access bug (JSONB stores snake_case, dashboard read camelCase)
- **80-04**: Counter-proposed uses amber accent (matches waiting/paused) per design system status colors
- **80-05**: Reject signal payload includes originalDescription only for reject type (not accept)
- **80-05**: Counter-proposal rejection returns immediately without pausing -- delegator continues to re-delegate
- **81-01**: FKs defined in migration SQL only to avoid circular Drizzle reference (taskGroups -> conversations -> tasks -> taskGroups)
- **81-01**: Task 'failed' status absent from schema but tracked in GroupState counts for evaluatePolicy correctness
- **81-02**: Direct DB update for group_id on tasks (TaskService.create does not accept groupId)
- **81-02**: Capability routing returns explicit error referencing Phase 85 (forward-compatible schema)
- **81-02**: Group timeout scheduling is no-op when timeoutScheduler is undefined (Plan 04 wires it)
- **81-03**: group_task_failed for all_required policy failures vs group_policy_unsatisfiable for other policies
- **81-03**: SELECT FOR UPDATE on task_groups row prevents concurrent duplicate signal dispatch
- **81-03**: Settled transition independent of policy evaluation (group can be satisfied but not yet settled)
- **81-04**: GroupService conditional on taskService in worker loop, unconditional in main.ts for dispatcher
- **81-04**: Group timeout null in WaitForState (pg-boss handles via delegate_group, prevents double-scheduling)
- **81-04**: DelegationDeps condition extended to detect group tool refs (delegate_group, group_status, cancel_group)
- **81-05**: pending_cancellation set on both resume and queue paths for task_cancelled signals
- **81-05**: Cancellation check placed before waitForState.triggered so it takes precedence
- **81-05**: Cascade uses fire-and-forget pattern with catch for non-fatal failure tolerance
- **81-06**: Group nodes use 280x90px dimensions (vs 220x80 for task nodes) for visual distinction
- **81-06**: Edge re-parenting: delegator -> group node -> individual tasks (removes direct edges for grouped tasks)
- **81-06**: MiniMap uses groupStatus for group node colors (satisfied=green, active=amber, unsatisfiable=red)
- **82-01**: MaterializationAdapter interface uses explicit typed params (not generic Record) for compile-time safety
- **82-01**: stateType takes precedence over statusName when both provided in update_issue_status
- **82-01**: materializationSyncStatusValues enum constrained to active/completed/failed in Drizzle schema
- **82-02**: Materialization sections placed in domain_knowledge after delegation sections for natural reading flow
- **82-02**: Dev-agent emphasizes internal for sub-agents; product-agent emphasizes transparent for dev/qa delegations
- **82-02**: Zero strong directives in materialization sections -- judgment-oriented per PROMPT_GUIDE.md
- **82-03**: agent-work label resolved lazily on first create() and cached for adapter lifetime
- **82-03**: handleWebhook is synchronous per interface; caller resolves materialization record context
- **82-03**: parentIssueId type changed to string | undefined for exactOptionalPropertyTypes compatibility
- **82-04**: Conditional spread for parentIssueId to satisfy exactOptionalPropertyTypes (avoid string|undefined)
- **82-04**: Parent Linear issue resolved once per group (not per task) for efficiency
- **82-04**: Group label uses last 8 chars of group UUID for readability (group-{shortId})
- **82-04**: Materialization fires after task creation but before conversation start
- **82-05**: Materialization routing placed after webhook filter but before task routing (step 1.4 in router pipeline)
- **82-05**: Non-materialized linear.issue.updated events ignored in router (not in IGNORE_EVENT_TYPES) for cleaner flow
- **82-05**: MaterializationAdapter created before executor in bootstrap to pass as constructor option (not late-bound)
- **82-05**: Forward sync uses fire-and-forget pattern with catch for non-fatal failure tolerance
- **82-05**: Composite dispatcher lambda wraps both signalDispatcher and forwardSyncListener
- **84-01**: cron-parser added as direct dependency (pnpm strict isolation prevents transitive resolution from pg-boss)
- **84-01**: ScheduleRegistry uses late-bound setEventHandler() for main.ts wiring (not constructor dependency)
- **84-01**: PgBoss type referenced as named export import("pg-boss").PgBoss (not default)
- **84-01**: Overlap detection queries conversations table directly via pool (not through executor)
- **84-01**: Composite PK on schedule_state uses drizzle-orm primaryKey() helper (first in schema)

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)
4. **Linear OAuth token migration** -- deadline April 1, 2026 (LSDK-02 shipped)
5. **event.routed sequence=0 collision** -- second routing event per conversation silently dropped (moderate)
6. **work:register/query absent from agent definitions** -- add to dev-agent and product-agent YAML (low)
7. **12 human verification items** -- visual/interactive testing across Phases 77-79
8. **Add `failed` to taskStatusValues** -- schema has no `failed` task status, but evaluatePolicy and TERMINAL_STATUSES reference it. Add to schema + migration, update getGroupState switch, clean up dead refs. Natural home: Phase 83 or 86 (both touch task lifecycle).

### Blockers/Concerns

- Linear Agent SDK is developer preview -- feature flag (LINEAR_AGENT_SDK_ENABLED) may be needed for fallback
- Linear OAuth token migration deadline: April 1, 2026
- worker-loop.ts is modified by Phases 80, 81, 83, 85, 86, 87 -- explicit file ownership needed for parallel execution

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 84-01-PLAN.md
Resume file: .planning/phases/84-scheduled-execution/84-01-SUMMARY.md
Next action: Execute 84-02-PLAN.md (event-router integration and main.ts wiring)

---
*Updated: 2026-02-22 -- Completed 84-01 (schedule foundation). Phase 84 in progress.*
