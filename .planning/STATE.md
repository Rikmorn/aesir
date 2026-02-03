# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.3 Unified Agent Framework -- Phase 46 in progress

## Current Position

Phase: 46 of 47 (Pre-Cleanup Verification)
Plan: 2 of 2 in current phase
Status: In progress
Last activity: 2026-02-03 -- Completed 46-02-PLAN.md (Docker Compose Validation)

Progress: [█████████░] ~94% (30/~32 estimated plans)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |

## Performance Metrics

**Velocity:**
- Total plans completed: 30 (v2.3)
- Average duration: ~5m19s
- Total execution time: ~156m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 37 | 3/3 | 20m09s | 6m43s |
| 38 | 4/4 | 20m59s | 5m15s |
| 39 | 2/2 | 16m50s | 8m25s |
| 40 | 3/3 | ~28m | ~9m20s |
| 41 | 2/2 | 12m | 6m |
| 42 | 3/3 | 12m05s | 4m02s |
| 43 | 2/2 | 12m02s | 6m01s |
| 44 | 2/2 | 6m | 3m |
| 45 | 3/3 | 32m36s | 10m52s |
| 46 | 2/2 | ~3m | ~1m30s |

*Updated after each plan completion*

## Accumulated Context

### Decisions

v2.0/v2.1/v2.2 decisions archived in milestones/.

v2.3 decisions:
- Custom SKIP LOCKED executor over generic job queue (pg-boss/graphile-worker) -- conversation semantics don't map to generic job abstractions
- pg-boss for timeout scheduling only -- delayed signal delivery is a pure delayed-job problem
- JSONB messages column with persist-at-boundaries strategy -- avoids write amplification
- Gapless sequences per conversation (MAX(sequence) + 1) -- one loop at a time per conversation makes this safe
- Executor columns (claimed_by, claimed_at, last_heartbeat_at) added to conversations table in 37-01 migration -- avoids second migration in Phase 40
- ArtifactExtractionConfig uses Map<string, ArtifactExtractor> with payloadPath -- keeps Phase 37 independent of Phase 38 ToolRegistry
- Copy truncateJsonPayload into event-log.ts rather than shared utility -- avoids cross-module dependency for small helper
- Fire-and-forget subscriber notification via void handler().catch() -- errors must never block append()
- Atomic JSONB merge for artifact extraction using COALESCE + || operator -- simpler than read-merge-write, no race conditions
- ToolContext uses optional DevContainerManager and taskId -- not all agents need containers
- ToolRegistry reports ALL missing refs on resolve failure -- better developer experience than failing on first
- AgentDefinitionYamlSchema version is z.string() -- avoids YAML numeric coercion issues
- Agent definitions store unescaped prompt text in prompt.md -- files contain actual LLM-visible text, not TypeScript encoding
- Sub-agent tokenBudget set to standalone values (100k) -- v2.3 executor overrides with parent shared budget when spawning
- AgentRegistry verifies YAML id matches directory name -- prevents mismatched definitions
- AgentRegistry version mismatch returns cached definition with warning -- file-based registry only stores latest version
- MCP adapter uses create-all-then-find pattern -- preserves v2.2 batch factory compatibility without modifying existing tool files
- spawn_agent placeholder does NOT use createSpawnAgentTool -- Phase 40 replaces with ConversationExecutor-backed implementation
- structuredClone for deep-cloning messages in history manager -- correctness over performance
- Tool tier classification by name prefix rather than configurable map -- simpler, sufficient for v2.3
- Summary wrapped in <summary></summary> tags for detection -- simple regex parsing, unambiguous in message content
- Single-summary-block-with-merge strategy -- prevents summaries-of-summaries degradation
- Phase 2 error handling falls back to Phase 1 pruned result -- history manager is optimization, not safety mechanism
- WaitForState uses mutable flag pattern (not exceptions) for executor interception -- allows LLM to see confirmation and generate clean end_turn
- Signal schema uses optional deduplicationId stored in delivered_signal_ids JSONB array -- simple query path for dedup checks
- ConversationExecutor.signal() returns discriminated action union (resumed/queued/rejected/deduplicated) -- precise caller feedback
- Non-retryable errors as distinct classes (TokenBudgetExhaustedError, AgentAbortedError) -- enables instanceof checks in retry logic
- FOR UPDATE locking via Drizzle .for("update") rather than raw SQL -- keeps queries type-safe
- Previous attempt context injected from SessionProjection into re-trigger initial message -- gives agent awareness of prior work
- Signal validation via SignalSchema.safeParse before transaction -- fail fast on invalid payloads
- Context-serialization for resumed conversations -- serializes prior messages as context parameter to runAgentLoop rather than modifying its signature
- Raw SQL CTE for SKIP LOCKED claiming -- Drizzle query builder cannot compose CTEs with FOR UPDATE SKIP LOCKED
- Ownership verification after agent loop before persisting results -- prevents split-brain writes from stale detection race
- pg-boss PgBoss class is named export in v12.8.0 -- import as { PgBoss } not default
- pg-boss cancel() requires queue name + job ID -- cancel(TIMEOUT_QUEUE, jobId) not cancel(jobId)
- Duration parser supports 'm' (minutes) for testing convenience -- "30m" is useful for development
- Executor factory refactored to named const variable -- enables closure access from startWorker for timeoutScheduler.start(executor)
- Timeout scheduling failure is non-fatal -- conversation still pauses without timeout job
- timeoutJobId stored in pending_wait JSONB -- optional field for cancellation lookup
- Start events preserve original dotted type for trigger matching; signal events use domain-language types for wait_for matching
- GitHub adapter returns null on non-matching branch names -- unresolvable correlation falls through to slow-path
- Linear issue.created/updated adapted (not null) so EventRouter can match IGNORE_EVENT_TYPES
- Domain-language signal types (approval, pr_review, pr_merged, pr_closed) instead of Temporal signal names (planApproval, prFeedback, prCompletion)
- Split prCompletion into pr_merged and pr_closed -- more precise signal semantics
- createSendMessageTool reused with type cast in routeViaAgentLoopV2 -- _deps parameter is unused
- SIGNAL_AGENT_MAP as static Record for signal-to-agent resolution -- simple, sufficient for current 2-agent system
- EventRouter.handle() is synchronous (no I/O) -- all async work in loadStartRules()
- Missing correlationKey on start/signal events falls to slow_path (not error) -- graceful degradation
- Duplicate trigger registrations log warning and first-wins -- deterministic behavior
- PR review events have no correlationKey (branchName not in review payloads) -- always routes to slow_path
- slack.message.created differentiates thread_reply vs channel_message based on threadTs presence
- linear.agent_session.prompted falls back to payload.body when payload.prompt is absent
- Idempotent start detection via conversation ID comparison -- no executor interface changes needed
- Helper functions use deps.logger instead of child logger parameter -- avoids Pino Logger<never> vs Logger<string> type mismatch
- DEFINITIONS_DIR resolved via fileURLToPath + path.resolve instead of __dirname (Biome naming convention rejects double-underscore prefixed variables)
- Volume name temporal-postgresql kept unchanged to preserve existing PostgreSQL data across service consolidation
- PRODUCT_AGENT_URL removed from .env.example -- events route through unified agent-service
- Test Express app replicates service/main.ts routes rather than importing it -- production main.ts calls process.exit on env validation failure
- Structural MockFn interface replaces vitest Mock import in helpers.ts -- avoids Mock<Procedure | Constructable> assignability issue in vitest 4.x
- Manual timeout signal simulation in integration tests -- TimeoutScheduler sends wait_timeout type which doesn't match pending_wait type; tests deliver matching-type signal instead
- Direct DB message injection for history compaction tests -- pre-populate 81 messages (40 tool pairs) to exceed 80000-token pruneThreshold
- Worker loop queued signal consumption bug fix -- re-reads queued_signals after wait_for triggers and auto-resumes if matching signal exists
- Docker Compose validation test event uses linear.issue.created (IGNORE_EVENT_TYPES) -- safe, requires no external state
- Validation script teardown does NOT use -v flag -- preserves database volumes between runs

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)
4. **Delete dead code: dev-agent/classification/approval.ts** (addressed in Phase 47)
5. **Add onToolResult callback to runAgentLoop()** (addressed by v2.3 event log)
6. **Add JSONB size limits to context_snapshots** (addressed by v2.3 replacing context_snapshots)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-03
Stopped at: Completed 46-02-PLAN.md (Docker Compose Validation)
Resume file: None
Next action: Phase 46 verification or Phase 47 (Cleanup)

---
*Updated: 2026-02-03 -- Phase 46 plan 02 complete (Docker Compose validation)*
