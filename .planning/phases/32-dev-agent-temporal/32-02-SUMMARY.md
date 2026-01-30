---
phase: 32
plan: 02
subsystem: temporal-workflow
tags: [temporal, workflow, orchestrator, signals, approval, feedback, worker, barrel-exports]
requires:
  - phase-32-01  # Orchestrator + infrastructure activities
  - phase-28  # runAgentLoop() core runtime
  - phase-29  # context-manager, task-store
  - phase-30  # HUMAN_INPUT_MARKER sentinel, tools
  - phase-31  # runDevAgentOrchestrator() entry point
provides:
  - orchestrator-workflow  # Simplified Temporal workflow with signal-based flow control
  - orchestrator-worker  # createOrchestratorWorker() on dev-agent-v2 task queue
  - orchestrator-types  # OrchestratorWorkflowInput, OrchestratorWorkflowPhase, OrchestratorWorkflowResult
  - orchestrator-query  # orchestratorStatusQuery for runtime status inspection
affects:
  - phase-32-03  # Tests for this workflow
  - phase-35  # Guardrails cleanup removes legacy dev-agent-workflow.ts
tech-stack:
  added: []
  patterns:
    - while-loop-approval-rejection
    - separate-proxy-activities-configs
    - signal-based-flow-control
    - conditional-property-assignment-for-exactOptionalPropertyTypes
key-files:
  created:
    - packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts
  modified:
    - packages/agents/src/shared/temporal/types.ts
    - packages/agents/src/dev-agent/worker.ts
    - packages/agents/src/shared/temporal/activities/index.ts
    - packages/agents/src/shared/temporal/workflows/index.ts
key-decisions:
  - id: "32-02-D1"
    decision: "While-loop for unlimited rejection/re-planning cycles"
    rationale: "Legacy workflow only handled one rejection then failed. The new while loop supports unlimited rejection/re-planning cycles, with rejection feedback stored in task store for orchestrator discovery."
  - id: "32-02-D2"
    decision: "Separate proxyActivities configs for orchestrator vs infrastructure"
    rationale: "Orchestrator activities (45min timeout, 2 retries) are expensive LLM loops; infrastructure activities (5min timeout, 3 retries) are fast container ops. Different retry characteristics prevent wasteful retries."
  - id: "32-02-D3"
    decision: "dev-agent-v2 task queue for orchestrator worker"
    rationale: "During transition period (Phase 35 removes legacy), both old and new workflows coexist on separate task queues to avoid registration collisions."
  - id: "32-02-D4"
    decision: "Activity interfaces redeclared in workflow file"
    rationale: "Temporal workflow code cannot import activity implementations (determinism constraint). Activity interfaces are redeclared with serializable types in the workflow file for proxyActivities."
duration: ~5 minutes
completed: 2026-01-30
---

# Phase 32 Plan 02: Simplified Orchestrator Workflow Summary

Simplified Temporal workflow replacing the 694-line legacy with signal-based flow control, unlimited rejection cycles, and dual worker registration on dev-agent-v2 task queue.

## Performance

| Metric | Value |
|--------|-------|
| Tasks completed | 2/2 |
| Duration | ~5 minutes |
| TypeScript | Clean (0 errors) |
| Biome | Clean (0 errors) |

## Accomplishments

1. Created orchestrator workflow implementing the simplified flow: setup -> pre-approval loop -> approval wait -> post-approval -> PR wait -> feedback loop -> complete
2. Added OrchestratorWorkflowInput, OrchestratorWorkflowPhase (10 values vs legacy 16), OrchestratorWorkflowResult with aggregate token tracking
3. While-loop approval supports unlimited rejection/re-planning cycles (legacy only handled one rejection then failed)
4. Separate proxyActivities configurations: orchestrator (45min/2 retries) and infrastructure (5min/3 retries) per research recommendations
5. Timeout pattern: 24h reminder with container stop -> 72h total approval timeout -> 7-day PR feedback timeout
6. Query handler exposes current workflow phase, PR info, and error messages with exactOptionalPropertyTypes-compatible conditional assignment
7. Added createOrchestratorWorker() on dev-agent-v2 task queue with full platform + agents dependency initialization
8. Updated barrel exports for both activities/index.ts and workflows/index.ts with aliased re-exports to avoid name collisions with legacy

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Orchestrator workflow types and simplified workflow | `1ccb647` | orchestrator-workflow.ts, types.ts |
| 2 | Worker registration and barrel export updates | `496411f` | worker.ts, activities/index.ts, workflows/index.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts` | Simplified orchestrator workflow with signal-based flow control (551 lines) |

## Files Modified

| File | Change |
|------|--------|
| `packages/agents/src/shared/temporal/types.ts` | Added OrchestratorWorkflowInput, OrchestratorWorkflowPhase, OrchestratorWorkflowResult |
| `packages/agents/src/dev-agent/worker.ts` | Added createOrchestratorWorker() with orchestrator activity registration on dev-agent-v2 queue |
| `packages/agents/src/shared/temporal/activities/index.ts` | Added orchestrator + infrastructure activity re-exports with aliases |
| `packages/agents/src/shared/temporal/workflows/index.ts` | Added orchestratorWorkflow and orchestratorStatusQuery exports |

## Decisions Made

### D1: While-loop for unlimited rejection/re-planning cycles
The legacy workflow handled plan rejection with nested conditionals that only supported one re-planning attempt before failing. The new workflow uses a `while (!approved)` loop that supports unlimited rejection/re-planning cycles. On rejection, feedback is passed to the pre-approval activity which stores it in the task store for the orchestrator to discover via its read_task_state tool.

### D2: Separate proxyActivities configs
Two distinct proxyActivities configurations separate orchestrator activities (45min startToCloseTimeout, 2 maximumAttempts) from infrastructure activities (5min, 3 attempts). This prevents Temporal from retrying expensive 30+ minute LLM loops the same way it retries fast container operations.

### D3: dev-agent-v2 task queue
The new orchestrator worker uses "dev-agent-v2" task queue, separate from the legacy "dev-agent" queue. This avoids workflow function name collisions during the transition period. Phase 35 will consolidate to a single queue.

### D4: Activity interfaces redeclared in workflow
Temporal workflow code must be deterministic and cannot import activity implementations. The workflow file redeclares activity interfaces with plain serializable types for use with proxyActivities. This is the standard Temporal TypeScript SDK pattern.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Plan 32-03 (activity and workflow tests) can proceed immediately. All artifacts are ready:
- Workflow function: `orchestratorWorkflow` with full signal/timeout/loop behavior
- Query: `orchestratorStatusQuery` for status inspection
- Types: `OrchestratorWorkflowInput`, `OrchestratorWorkflowPhase`, `OrchestratorWorkflowResult`
- Worker: `createOrchestratorWorker()` with dual registration
- All barrel exports updated
