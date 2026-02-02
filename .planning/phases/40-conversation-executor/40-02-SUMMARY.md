---
phase: 40-conversation-executor
plan: 02
subsystem: agent-framework
tags: [conversation-executor, api, drizzle, transactions, idempotent, signal, deduplication]
requires:
  - phase-37 (conversations table, agent events schema)
  - phase-38 (tool registry)
  - phase-40-plan-01 (ConversationExecutor interface, Signal schema, WaitForState, executor columns)
provides:
  - createConversationExecutor factory implementing all 5 API methods
  - Deterministic conversation ID generation (agentDefinitionId-correlationKey)
  - Idempotent start for active conversations
  - Re-trigger with suffix for terminal conversations
  - Signal delivery with resume/queue/dedup/reject actions
  - 41 unit tests for full API coverage
affects:
  - phase-40-plan-03 (worker loop calls internal methods, uses signal delivery)
tech-stack:
  added: []
  patterns:
    - FOR UPDATE row locking in Drizzle transactions
    - Deterministic ID generation from composite keys
    - Re-trigger suffix pattern (-r2, -r3) for conversation retry
    - Signal deduplication via source:deduplicationId in JSONB array
key-files:
  created:
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/conversation-executor.test.ts
  modified:
    - packages/agents/src/framework/index.ts
key-decisions:
  - FOR UPDATE locking via Drizzle .for("update") method rather than raw SQL
  - Previous attempt context injected from SessionProjection artifacts into re-trigger initial message
  - Signal validation via SignalSchema.safeParse before transaction (fail fast on invalid payloads)
  - EventLog flush called inside transaction for signal.received and cancel events
duration: 9m03s
completed: 2026-02-02
---

# Phase 40 Plan 02: ConversationExecutor Core Implementation Summary

createConversationExecutor factory with 5 API methods (start, signal, get, cancel, list) implementing idempotent starts, deterministic IDs, re-trigger suffixes, signal delivery with deduplication, and conversation lifecycle management via Drizzle transactions with FOR UPDATE locking.

## Performance

- **Duration:** 9m03s
- **Tasks:** 2/2 completed
- **Tests added:** 41 (conversation executor API)
- **Total tests passing:** 787 (746 existing + 41 new)
- **Build:** Clean TypeScript compilation

## Accomplishments

1. **ConversationExecutor factory** (`createConversationExecutor`) implements all 5 methods of the ConversationExecutor interface. Uses Drizzle ORM transactions with FOR UPDATE row locking for concurrent safety.

2. **start()** computes deterministic conversation IDs as `agentDefinitionId-correlationKey`. For active conversations (running/queued/waiting) returns existing ID (idempotent no-op). For terminal conversations (completed/failed/cancelled) creates new conversation with `-r2`/`-r3` suffix and injects previous attempt context from SessionProjection.

3. **signal()** validates payloads via SignalSchema, deduplicates by `source:deduplicationId`, resumes waiting conversations (type match check against pending_wait), queues signals for running/queued conversations, and rejects for terminal status or type mismatch.

4. **get()/cancel()/list()** provide conversation info retrieval, cancellation with event logging, and filtered listing with status/agentDefinitionId filters.

5. **41 unit tests** cover all 5 API methods including edge cases: factory validation (7), new conversation (6), idempotent no-op (3), re-trigger (4), signal resume (4), signal queue (2), signal dedup (2), signal rejection (3), get (2), cancel (5), list (3).

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | ConversationExecutor factory implementation | 8c6aa0f | conversation-executor.ts, index.ts |
| 2 | Unit tests for ConversationExecutor API | 680eefe | conversation-executor.test.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/framework/conversation-executor.ts` | createConversationExecutor factory with 5 API methods |
| `packages/agents/src/framework/conversation-executor.test.ts` | 41 unit tests covering all ConversationExecutor methods |

## Files Modified

| File | Changes |
|------|---------|
| `packages/agents/src/framework/index.ts` | Added export for createConversationExecutor |

## Decisions Made

1. **FOR UPDATE via Drizzle `.for("update")`** -- Used Drizzle's built-in locking clause method rather than raw SQL. Drizzle 0.45+ supports `LockStrength` type for `for()` method, keeping queries type-safe.

2. **Previous attempt context from SessionProjection** -- Re-triggered conversations inject context about the previous attempt (status, failure reason, known artifacts) from the session projection into the initial message. This gives the agent awareness of prior work.

3. **Signal validation before transaction** -- `SignalSchema.safeParse()` runs before entering the database transaction to avoid unnecessary locking on invalid payloads.

4. **EventLog flush inside cancel/signal operations** -- `agent.completed` events (for cancel) and `signal.received` events (for resume) are flushed immediately to ensure event persistence within the transaction scope.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Plan 03 can proceed immediately:
- **Plan 03** implements the worker loop (claim, execute, heartbeat) and spawn_agent tool
- All API methods are implemented and exported
- 787 tests passing with no regressions
- The executor columns (claimed_by, claimed_at, last_heartbeat_at) from migration 0002 are ready for Plan 03's SKIP LOCKED pattern
