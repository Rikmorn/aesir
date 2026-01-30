---
phase: 35-guardrails-cleanup
plan: 02
subsystem: agents
tags: [temporal-retry, heartbeat, non-retryable-errors, backoff-cap, activity-config]

# Dependency graph
requires:
  - phase: 35-guardrails-cleanup
    plan: 01
    provides: onHeartbeat callback in AgentLoopOptions, TokenBudgetExhaustedError
  - phase: 32-orchestrator-workflow
    provides: orchestrator-workflow.ts, orchestrator-activities.ts, proxyActivities configs
provides:
  - Heartbeat timeout (5 min) preventing premature Temporal activity cancellation
  - Non-retryable error types preventing expensive LLM retry on budget exhaustion or user abort
  - Backoff caps (2 min orchestrator, 30s infrastructure) preventing excessive retry delays
  - Heartbeat wired from Temporal activity context through orchestrator to agent loop
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getHeartbeatFn() helper wraps Context.current().heartbeat() with try/catch for test safety"
    - "Callback-based heartbeat keeps agent loop framework-agnostic (Temporal context stays in activity layer)"
    - "Non-retryable error types prevent Temporal from retrying permanent failures"

key-files:
  created: []
  modified:
    - packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts
    - packages/agents/src/shared/temporal/workflows/orchestrator-workflow.test.ts
    - packages/agents/src/shared/temporal/activities/orchestrator-activities.ts
    - packages/agents/src/shared/temporal/activities/orchestrator-activities.test.ts
    - packages/agents/src/dev-agent/orchestrator/orchestrator.ts

key-decisions:
  - "heartbeatTimeout: 5 minutes balances keep-alive frequency with overhead (fires after each LLM response, ~5-10s)"
  - "initialInterval increased from 10s to 30s for orchestrator retries -- transient API issues often resolve in 10-30s"
  - "Non-retryable: TokenBudgetExhaustedError (permanent -- shared budget stays exhausted) and AgentAbortedError (user intent)"
  - "getHeartbeatFn() uses try/catch around Context.current() for graceful degradation in tests"
  - "onHeartbeat added to OrchestratorOptions interface for clean pass-through to AgentLoopOptions"

patterns-established:
  - "Activity-level heartbeat helper (getHeartbeatFn) for Temporal activity context isolation"
  - "Non-retryable error types for permanent LLM failures (budget, abort)"

# Metrics
duration: 3min
completed: 2026-01-30
---

# Phase 35 Plan 02: Temporal Retry Config & Heartbeat Wiring Summary

**Configured heartbeat timeout (5min), non-retryable error types (budget/abort), backoff caps, and wired Temporal activity heartbeat through orchestrator to agent loop**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-30T22:16:07Z
- **Completed:** 2026-01-30T22:19:19Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Orchestrator proxyActivities now has heartbeatTimeout: "5 minutes" preventing premature timeout on long agentic loops
- Initial retry interval increased from 10s to 30s giving transient API issues time to clear
- Maximum retry interval capped at 2 minutes (orchestrator) and 30 seconds (infrastructure)
- TokenBudgetExhaustedError and AgentAbortedError marked as non-retryable (no wasted LLM spend on permanent failures)
- getHeartbeatFn() helper safely wraps Temporal Context.current().heartbeat() with try/catch
- All three orchestrator activities (pre-approval, post-approval, feedback) wire onHeartbeat to the agent loop
- OrchestratorOptions extended with onHeartbeat for clean pass-through to AgentLoopOptions

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Temporal retry configs in orchestrator workflow** - `1ce4e1f` (feat)
2. **Task 2: Wire heartbeat from activity context into runAgentLoop** - `607db27` (feat)

## Files Created/Modified
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts` - Added heartbeatTimeout, increased initialInterval, added maximumInterval caps, added nonRetryableErrorTypes
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.test.ts` - Updated proxy config tests to reflect new values
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.ts` - Added getHeartbeatFn() helper, wired onHeartbeat in all 3 activities
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.test.ts` - Added @temporalio/activity mock, 5 heartbeat wiring tests
- `packages/agents/src/dev-agent/orchestrator/orchestrator.ts` - Added onHeartbeat to OrchestratorOptions, passed through to AgentLoopOptions

## Decisions Made
- heartbeatTimeout: "5 minutes" -- Temporal cancels if no heartbeat for 5 min; since the loop fires onHeartbeat after each LLM response (~5-10s), this is well within bounds
- initialInterval: "30 seconds" (was "10 seconds") -- transient Anthropic API errors and rate limits typically resolve in 10-30 seconds
- maximumInterval: "2 minutes" for orchestrator, "30 seconds" for infrastructure -- prevents exponential backoff from growing unbounded
- nonRetryableErrorTypes: TokenBudgetExhaustedError (shared mutable budget stays exhausted after attempt 1) and AgentAbortedError (user explicitly cancelled)
- getHeartbeatFn() uses try/catch around Context.current() for graceful degradation outside activity context (tests, CLI)
- onHeartbeat added to OrchestratorOptions rather than being captured at activity scope -- cleaner DI pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added onHeartbeat to OrchestratorOptions**
- **Found during:** Task 2
- **Issue:** The plan specified wiring onHeartbeat in activity functions, but the orchestrator entry point (orchestrator.ts) had no way to receive the heartbeat callback from the activity
- **Fix:** Added `onHeartbeat?: () => void` to `OrchestratorOptions` interface and passed it through to `AgentLoopOptions` in the orchestrator function
- **Files modified:** packages/agents/src/dev-agent/orchestrator/orchestrator.ts
- **Commit:** 607db27

---

**Total deviations:** 1 auto-fixed (missing critical -- heartbeat pass-through interface)
**Impact on plan:** Required for heartbeat to flow from activity context to agent loop. No scope creep.

## Issues Encountered
- Pre-existing @aesir/types package resolution failure prevents orchestrator-activities.test.ts from running in Vitest -- this is documented in project state as a known pre-existing infrastructure issue affecting all test files that transitively import from @aesir/types
- Workflow tests (orchestrator-workflow.test.ts) run successfully as they mock the Temporal module and don't transitively import @aesir/types

## Next Phase Readiness
- Heartbeat wiring complete -- activities will keep long-running agentic loops alive in Temporal
- Non-retryable errors configured -- budget exhaustion and user abort won't trigger expensive retries
- Plan 35-03 (LangGraph removal) already complete from Wave 1
- Plan 35-04 (remove @langchain packages) is next

---
*Phase: 35-guardrails-cleanup*
*Completed: 2026-01-30*
