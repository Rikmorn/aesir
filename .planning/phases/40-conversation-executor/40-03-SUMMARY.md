---
phase: 40-conversation-executor
plan: 03
subsystem: agent-framework
tags: [worker-loop, poll, claim, skip-locked, heartbeat, stale-recovery, drain, wait-for, agent-loop, retry]
requires:
  - phase-37 (conversations table, agent_events, event log)
  - phase-38 (agent registry, tool registry)
  - phase-39 (history manager for conversation compaction)
  - phase-40-plan-01 (executor columns, WaitForState, wait_for tool)
  - phase-40-plan-02 (ConversationExecutor API methods)
provides:
  - createWorkerLoop factory with poll, claim, execute, heartbeat, recover, drain
  - Full executeConversation implementation bridging queued conversations to runAgentLoop
  - Real wait_for tool in tool-factories.ts replacing placeholder
  - startWorker/stopWorker on ConversationExecutor interface
  - 32 unit tests for worker loop behavior
affects:
  - phase-41 (timeout scheduling delivers signals to conversations managed by worker loop)
  - phase-42 (event router calls executor.start/signal which queues work for worker loop)
  - phase-44 (single service consolidation starts worker loop as part of unified service)
tech-stack:
  added: []
  patterns:
    - SELECT FOR UPDATE SKIP LOCKED via raw SQL CTE for atomic conversation claiming
    - setTimeout-based polling (not setInterval) to prevent overlap
    - Fire-and-forget execution with AbortController per conversation
    - Heartbeat callback via onHeartbeat in runAgentLoop
    - Context-serialization for resumed conversations (prior messages as context parameter)
    - WaitForState mutable flag interception for wait_for tool detection
key-files:
  created:
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/worker-loop.test.ts
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts
    - packages/agents/src/framework/index.ts
key-decisions:
  - "Context-serialization for resumed conversations -- serializes prior messages as context parameter to runAgentLoop rather than modifying its signature"
  - "Real timers with short poll intervals for tests -- vi.useFakeTimers caused worker crashes with async polling loops"
  - "Raw SQL CTE for SKIP LOCKED claiming -- Drizzle query builder does not compose CTEs with FOR UPDATE SKIP LOCKED"
patterns-established:
  - "Worker loop poll pattern: setTimeout-based with capacity check, stale recovery, claim, fire-and-forget execute"
  - "Ownership verification after async work: verify claimed_by before persisting results"
  - "Queued signal consumption: check queued_signals before agent loop to prevent unnecessary pauses"
duration: ~15min
completed: 2026-02-02
---

# Phase 40 Plan 03: Worker Loop Summary

Worker loop execution engine with SKIP LOCKED claiming, heartbeat monitoring, stale recovery, wait_for interception, queued signal consumption, retry semantics, and graceful shutdown -- the component that turns queued conversations into running agent loops.

## Performance

- **Duration:** ~15min
- **Tasks:** 3/3 completed
- **Tests added:** 32 (worker loop) + 1 updated (tool-factories wait_for test)
- **Total tests passing:** 1175 (no regressions, 65 test files)
- **Build:** Clean TypeScript compilation

## Accomplishments

1. **Worker loop core** (`createWorkerLoop`) implements the full poll cycle: setTimeout-based polling, stale conversation recovery, atomic claiming via raw SQL CTE with `FOR UPDATE SKIP LOCKED`, fire-and-forget `executeConversation()` with `AbortController`, and graceful shutdown via `drain()`/`close()`.

2. **Full executeConversation implementation** bridges the gap from database rows to running agent loops: loads agent definition, resolves tools, intercepts wait_for via WaitForState mutable flag, consumes matching queued signals before running the loop, applies history compaction, calls `runAgentLoop()` with context-serialization for resumed conversations, monitors heartbeat, verifies ownership after completion, and handles all outcome states (completed/waiting/error/aborted).

3. **Real wait_for tool** in tool-factories.ts replaces the Phase 38 placeholder. The tool now uses `createWaitForTool(defaultState)` which returns a proper confirmation message. When the executor runs, it replaces the execute function with one bound to a per-conversation WaitForState for interception.

4. **ConversationExecutor interface** updated with `startWorker()`/`stopWorker()` methods, wired through `conversation-executor.ts` to the worker loop with lazy initialization.

5. **32 unit tests** cover all worker loop behavior: claiming (5), heartbeat (3), stale recovery (4), completion (3), wait_for pause (3), retry on error (3), ownership verification (2), graceful shutdown (3), queued signal consumption (2), aborted (1), agent definition not found (1), lifecycle events (2).

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Worker loop core (poll, claim, stale recovery, drain) | 8c014bd | worker-loop.ts, types.ts, conversation-executor.ts, index.ts |
| 2 | Replace wait_for placeholder with real implementation | 0a44a26 | tool-factories.ts, tool-factories.test.ts |
| 3 | Worker loop unit tests | 5def6e0 | worker-loop.test.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/framework/worker-loop.ts` | createWorkerLoop factory -- poll, claim, execute, heartbeat, recover, drain |
| `packages/agents/src/framework/worker-loop.test.ts` | 32 unit tests for worker loop behavior |

## Files Modified

| File | Changes |
|------|---------|
| `packages/agents/src/framework/types.ts` | Added startWorker/stopWorker to ConversationExecutor interface |
| `packages/agents/src/framework/conversation-executor.ts` | Wired startWorker/stopWorker via lazy worker loop creation |
| `packages/agents/src/framework/tool-factories.ts` | Replaced wait_for placeholder with real createWaitForTool implementation |
| `packages/agents/src/framework/tool-factories.test.ts` | Updated wait_for test to expect real tool behavior (confirmation, not isError) |
| `packages/agents/src/framework/index.ts` | Added exports for createWorkerLoop, WorkerLoop, WorkerLoopOptions |

## Decisions Made

1. **Context-serialization for resumed conversations** -- `runAgentLoop()` does not accept pre-existing messages; it always starts fresh. For resumed conversations, the prior message history is serialized as JSON and passed as the `context` parameter, giving the LLM full history context in a single user message. This avoids modifying `runAgentLoop`'s signature (future optimization can add native multi-turn support).

2. **Raw SQL CTE for SKIP LOCKED claiming** -- Drizzle's query builder cannot compose CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE ... FROM` in a single atomic statement. Used `db.execute(sql`...`)` for the claim query while keeping all other queries in Drizzle.

3. **Real timers for async polling tests** -- `vi.useFakeTimers()` caused worker process crashes when combined with async polling loops and fire-and-forget execution. Switched to real timers with 10ms poll intervals and 50ms tick helpers, which is reliable and fast.

4. **Ownership verification after agent loop** -- Before persisting results, the worker verifies that `claimed_by` still matches its worker ID. If stale detection re-assigned the conversation during execution, results are discarded to prevent split-brain writes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript exactOptionalPropertyTypes error in conversation-executor.ts**
- **Found during:** Task 1
- **Issue:** Passing `undefined` for optional properties in WorkerLoopOptions violated exactOptionalPropertyTypes
- **Fix:** Used conditional property assignment: `if (x !== undefined) opts.x = x`
- **Files modified:** packages/agents/src/framework/conversation-executor.ts
- **Committed in:** 8c014bd (Task 1 commit)

**2. [Rule 1 - Bug] executeConversation implemented fully in Task 1 instead of stub**
- **Found during:** Task 1
- **Issue:** Plan specified Task 1 as stub + Task 2 as full implementation, but since the worker loop needs executeConversation to function, implementing it fully in Task 1 was more coherent
- **Fix:** Merged the Task 2 executeConversation work into Task 1. Task 2 focused purely on the tool-factories.ts wait_for replacement
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Committed in:** 8c014bd (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs/blocking)
**Impact on plan:** Minimal. executeConversation was implemented one task earlier than planned. All functionality delivered as specified.

## Issues Encountered

1. **Fake timers crash with async polling** -- `vi.useFakeTimers()` with `vi.advanceTimersByTimeAsync()` caused the Vitest worker to crash/timeout when testing the fire-and-forget polling loop. Resolved by switching to real timers with very short poll intervals (10ms).

2. **Biome noThenProperty lint rule** -- Mocking Drizzle's thenable query results with `Object.assign(p, { then: ... })` triggered lint errors. Resolved by using `vi.fn().mockResolvedValue()` / `vi.fn().mockRejectedValue()` instead.

3. **Multiple TypeScript strictness issues** -- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and mock type inference required careful typing with `satisfies`, explicit casts, and guard conditions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 40 is now complete (3/3 plans). The v2.3 executor is fully functional:
- **Phase 41** (Timeout Scheduling) can proceed -- pg-boss delivers timeout signals via `executor.signal()`
- **Phase 42** (Event Router) can proceed -- webhook adapters call `executor.start()` and `executor.signal()`
- All framework components are implemented, tested, and exported
- 1175 tests passing across 65 test files with no regressions
- 249 framework-specific tests covering all 9 framework modules

---
*Phase: 40-conversation-executor*
*Completed: 2026-02-02*
