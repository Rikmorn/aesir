---
phase: 40-conversation-executor
plan: 01
subsystem: agent-framework
tags: [database, migration, types, interfaces, wait-for-tool, executor]
requires:
  - phase-37 (conversations table, agent events schema)
  - phase-38 (tool registry, tool factories)
provides:
  - Migration 0002 with executor columns (retry, signal dedup, parent conversation, LZ4)
  - ConversationExecutor interface contract (5 methods)
  - Signal Zod schema for payload validation
  - WaitForState type for executor interception
  - Real wait_for tool replacing Phase 38 placeholder
  - Non-retryable error classes (TokenBudgetExhaustedError, AgentAbortedError)
affects:
  - phase-40-plan-02 (implements ConversationExecutor against these types)
  - phase-40-plan-03 (implements signal delivery and spawn_agent)
tech-stack:
  added: []
  patterns:
    - Mutable state flag for tool-to-executor communication
    - Zod schema validation for external signal payloads
    - Idempotent SQL migration with IF NOT EXISTS guards
key-files:
  created:
    - packages/agents/src/shared/db/migrations/0002_add_executor_columns.sql
    - packages/agents/src/framework/wait-for-tool.ts
    - packages/agents/src/framework/wait-for-tool.test.ts
  modified:
    - packages/agents/src/shared/db/migrations/meta/_journal.json
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/index.ts
key-decisions:
  - WaitForState uses mutable flag pattern (not exceptions) for executor interception
  - Signal schema uses optional deduplicationId for idempotent delivery
  - ConversationExecutor.signal() returns discriminated action union (resumed/queued/rejected/deduplicated)
  - LZ4 compression on messages JSONB column targets PostgreSQL 14+ (project uses 15+)
  - Partial index on parent_conversation_id (WHERE NOT NULL) for efficient sub-agent lookups
duration: 4m25s
completed: 2026-02-02
---

# Phase 40 Plan 01: Schema, Types, and wait_for Tool Summary

Database migration for executor columns, ConversationExecutor interface contract, and real wait_for tool with flag-based executor interception replacing the Phase 38 placeholder.

## Performance

- **Duration:** 4m25s
- **Tasks:** 3/3 completed
- **Tests added:** 13 (wait_for tool)
- **Total tests passing:** 746 (733 existing + 13 new)
- **Build:** Clean TypeScript compilation

## Accomplishments

1. **Migration 0002** adds 5 columns to `agents.conversations`: `retry_count`, `max_retries`, `error_message`, `delivered_signal_ids`, `parent_conversation_id`. Sets LZ4 compression on `messages` JSONB column. Partial index on `parent_conversation_id` for sub-agent lookups.

2. **ConversationExecutor interface** defines the 5-method API contract (start, signal, get, cancel, list) that Plans 02 and 03 implement. Includes supporting types: `StartConversationParams`, `ConversationInfo`, `ConversationExecutorOptions`, `Signal` (Zod), `WaitForState`.

3. **Real wait_for tool** replaces the Phase 38 placeholder with a working implementation. Uses mutable `WaitForState` flag pattern -- the tool sets `triggered = true` and returns a confirmation message (not an error), allowing the LLM to generate a clean end_turn. The executor checks the flag after loop exit to transition the conversation to "waiting" status.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Migration 0002 and Drizzle schema update | 3acc024 | 0002_add_executor_columns.sql, schema.ts, schema.drizzle.ts, _journal.json |
| 2 | ConversationExecutor interface and framework types | 9f936b6 | types.ts, index.ts |
| 3 | Real wait_for tool implementation with tests | 1eaa7e9 | wait-for-tool.ts, wait-for-tool.test.ts, index.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/db/migrations/0002_add_executor_columns.sql` | Migration adding retry, signal dedup, parent conversation columns + LZ4 compression |
| `packages/agents/src/framework/wait-for-tool.ts` | createWaitForTool factory and createDefaultWaitForState helper |
| `packages/agents/src/framework/wait-for-tool.test.ts` | 13 unit tests for wait_for tool behavior |

## Files Modified

| File | Changes |
|------|---------|
| `packages/agents/src/shared/db/migrations/meta/_journal.json` | Added entry idx: 2 for 0002_add_executor_columns |
| `packages/agents/src/shared/db/schema.ts` | Added 5 columns and partial index to conversations table |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Mirrored schema.ts changes for drizzle-kit compatibility |
| `packages/agents/src/framework/types.ts` | Added SignalSchema, WaitForState, ConversationExecutor interface, error classes |
| `packages/agents/src/framework/index.ts` | Added exports for wait-for-tool and new types |

## Decisions Made

1. **Mutable flag pattern for wait_for** -- The wait_for tool sets a `triggered` flag on a shared `WaitForState` object rather than throwing an exception. This allows the LLM to see the confirmation message and generate a clean end_turn response, making the pause explicit in the conversation history.

2. **Signal schema with optional deduplicationId** -- The `Signal` Zod schema includes an optional `deduplicationId` field. When present, the executor checks `delivered_signal_ids` to prevent duplicate delivery. This is stored as a JSONB array rather than a separate table to keep the query path simple.

3. **Discriminated action union for signal()** -- The `signal()` method returns `{ action: "resumed" | "queued" | "rejected" | "deduplicated" }` rather than a boolean, giving callers precise feedback about what happened with the signal.

4. **LZ4 compression on messages column** -- Applied via `SET COMPRESSION lz4` which only affects new writes. Safe because the table was created in Phase 37 and targets PostgreSQL 15+ per project requirements.

5. **Non-retryable error classes** -- `TokenBudgetExhaustedError` and `AgentAbortedError` are separate error classes (not generic errors with codes) so the executor can use `instanceof` checks for retry decisions.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Plans 02 and 03 can proceed immediately:
- **Plan 02** implements `createConversationExecutor()` against the `ConversationExecutor` interface
- **Plan 03** implements signal delivery and replaces the spawn_agent placeholder
- All type contracts are defined and exported
- Migration 0002 must be run on the database before integration testing
