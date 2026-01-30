---
phase: 32
plan: 01
subsystem: temporal-activities
tags: [temporal, activities, orchestrator, container, sentinel, context-snapshot, DI]
requires:
  - phase-28  # runAgentLoop() core runtime
  - phase-29  # context-manager, task-store, schema
  - phase-30  # HUMAN_INPUT_MARKER sentinel, tools
  - phase-31  # runDevAgentOrchestrator() entry point
provides:
  - orchestrator-activities  # 3 activities wrapping runDevAgentOrchestrator()
  - infrastructure-activities  # 3 activities for container/task lifecycle
  - sentinel-parser  # parseHumanInputMarker() for HUMAN_INPUT_MARKER detection
  - activity-DI  # initOrchestratorActivities() + getOrchestratorDeps()
affects:
  - phase-32-02  # Workflow uses these activities via proxyActivities
  - phase-32-03  # Tests for these activities
  - phase-35  # Guardrails cleanup removes legacy dev-agent-activities.ts
tech-stack:
  added: []
  patterns:
    - module-level-DI-for-temporal-activities
    - sentinel-parsing-from-trace
    - slim-activity-outputs
    - context-snapshot-handoff
key-files:
  created:
    - packages/agents/src/shared/temporal/activities/orchestrator-activities.ts
    - packages/agents/src/shared/temporal/activities/infrastructure-activities.ts
  modified: []
key-decisions:
  - id: "32-01-D1"
    decision: "Shared deps via exported getOrchestratorDeps()"
    rationale: "Infrastructure activities need same deps as orchestrator activities; exporting the getter avoids duplicate DI modules while keeping files separate for different retry configs"
  - id: "32-01-D2"
    decision: "Rejection feedback stored in task store, not injected into initialMessage"
    rationale: "Follows Phase 31 self-sufficient agents principle; orchestrator reads task state via tools and discovers rejection feedback naturally"
  - id: "32-01-D3"
    decision: "Separate infrastructure-activities.ts file despite shared deps"
    rationale: "Infrastructure activities have different retry characteristics (shorter timeouts, more retries) than orchestrator activities and should use separate proxyActivities config in the workflow"
  - id: "32-01-D4"
    decision: "Branch creation left to orchestrator, not setup activity"
    rationale: "Separates infrastructure (spawn, git, clone) from reasoning (branch naming based on issue analysis); research recommendation"
duration: ~4 minutes
completed: 2026-01-30
---

# Phase 32 Plan 01: Orchestrator & Infrastructure Activities Summary

Temporal activity layer wrapping runDevAgentOrchestrator() with sentinel parsing, context snapshot handoff, and container lifecycle management.

## Performance

| Metric | Value |
|--------|-------|
| Tasks completed | 2/2 |
| Duration | ~4 minutes |
| TypeScript | Clean (0 errors) |
| Biome | Clean (0 errors) |

## Accomplishments

1. Created 3 orchestrator activities that wrap `runDevAgentOrchestrator()` and return slim serializable results (no full trace -- respects Temporal 2MB/4MB gRPC limit)
2. Implemented `parseHumanInputMarker()` that scans the entire agent loop trace for `request_human_input` tool results containing the `HUMAN_INPUT_MARKER` sentinel
3. Created 3 infrastructure activities for container lifecycle (setup, stop) and task completion (mark complete/failed)
4. Established module-level DI pattern: `initOrchestratorActivities()` sets deps once, `getOrchestratorDeps()` shared by both files
5. Context snapshots written at three stages: post-research-plan, post-execution, post-feedback -- enabling continuity across Temporal activity boundaries

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Orchestrator activities with DI, sentinel parsing, and context snapshot handoff | `07dab9e` | orchestrator-activities.ts |
| 2 | Infrastructure activities for container lifecycle and task completion | `7973760` | infrastructure-activities.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/temporal/activities/orchestrator-activities.ts` | 3 orchestrator activities + DI + sentinel parser + types (538 lines) |
| `packages/agents/src/shared/temporal/activities/infrastructure-activities.ts` | 3 infrastructure activities + types (229 lines) |

## Decisions Made

### D1: Shared deps via exported getOrchestratorDeps()
Infrastructure activities import `getOrchestratorDeps()` from orchestrator-activities.ts rather than having their own DI module. Both files use the same deps initialized once at worker startup. This avoids duplicate initialization while keeping files separate for different Temporal retry configurations.

### D2: Rejection feedback stored in task store
On re-planning (plan rejection), the pre-approval activity stores rejection feedback in the task store (`approvalFeedback` column, `approvalStatus: "rejected"`) rather than injecting it into the orchestrator's `initialMessage`. This follows Phase 31's self-sufficient agents principle -- the orchestrator reads task state via its tools and discovers feedback naturally.

### D3: Separate infrastructure file
Despite sharing deps, infrastructure activities live in a separate file because they have fundamentally different retry characteristics: infrastructure ops are fast (5 min timeout, 3 retries) while orchestrator loops are expensive (45 min timeout, 2 retries). The workflow uses separate `proxyActivities` configurations.

### D4: Branch creation deferred to orchestrator
The `setupContainerActivity` handles spawn, git credentials, and clone -- but NOT branch creation. Branch naming requires reasoning about the issue (the orchestrator decides branch names via `github_create_branch` tool). This separates infrastructure from reasoning per research recommendation.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Plan 32-02 (simplified orchestrator workflow) can proceed immediately. The 6 activities are ready for `proxyActivities` registration:
- Orchestrator: `runOrchestratorPreApproval`, `runOrchestratorPostApproval`, `handleOrchestratorFeedback`
- Infrastructure: `setupContainerActivity`, `stopContainerActivity`, `completeTaskActivity`

All input/output types are exported for workflow type safety. The sentinel parser and context snapshot pattern are established.
