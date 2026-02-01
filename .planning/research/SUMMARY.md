# Project Research Summary

**Project:** Aesir v2.3 Unified Agent Framework
**Domain:** Replacing Temporal orchestration with Postgres-backed conversation executor
**Researched:** 2026-02-01
**Confidence:** HIGH

## Executive Summary

v2.3 is an architectural shift from Temporal workflows to a Postgres-backed ConversationExecutor that treats agent loops as the primary state machine. The core finding: **Aesir uses approximately 5% of Temporal's capabilities** and can replace it with well-established Postgres patterns without sacrificing durability guarantees. The `SELECT FOR UPDATE SKIP LOCKED` job queue pattern (used by pg-boss, Solid Queue, DBOS, Inngest) is battle-tested at production scale for exactly this use case.

The recommended approach consolidates three disconnected persistence stores (execution_traces, tasks, context_snapshots) into a unified event log with reactive session projections. This eliminates the data consistency problems inherent in maintaining separate imperative stores while providing better observability than v2.2's incomplete trace logging. The single-service consolidation (from 4 containers to 1) is architecturally sound -- agent definitions become configuration files, not deployed services.

**Key risks:** JSONB write amplification on the messages column (CRITICAL), stale conversation detection without proper heartbeats (CRITICAL), and event log sequence gaps (CRITICAL). All three are preventable with careful implementation. The migration from Temporal requires a structured drain strategy due to workflows paused for hours/days waiting for approvals. Total effort: 15-18 development days plus 7-day drain window.

## Key Findings

### Recommended Stack

**Core recommendation:** Custom Postgres-backed executor for conversation orchestration, pg-boss for timeout scheduling, Drizzle ORM for schema management. No new job queue library needed for the core executor -- the conversation table IS the queue. The `SELECT FOR UPDATE SKIP LOCKED` pattern provides exactly the concurrency control needed with ~50 lines of SQL.

**Core technologies:**
- **Custom SKIP LOCKED executor** (not pg-boss/graphile-worker) -- conversation semantics (signal queueing, wait type matching, idempotent start) don't map to generic job queues. The conversation table is queried by status, pending_wait type, and conversation ID -- these are domain queries that libraries force into jobs/tasks/queues awkwardly.
- **pg-boss v12.8.0** for timeout scheduling only -- "wake this conversation in 72 hours" is a pure delayed-job problem that pg-boss solves with `startAfter` API, Postgres-backed persistence, and distributed worker support. Rolling a custom timeout scheduler would reinvent pg-boss badly.
- **Event log as append-only Postgres table** (not event sourcing library) -- batch INSERT via Drizzle ORM with LISTEN/NOTIFY for reactive subscriptions. Implementation is ~200 lines of TypeScript, no library needed.
- **Conversation history as JSONB column** -- write-rarely/read-fully pattern makes TOAST acceptable. Conversations persist only on pause/complete (not every tool call), avoiding write amplification. Phase 1 pruning keeps sizes 60-80% smaller. LZ4 compression available on Postgres 14+.

**Removed dependencies:**
- All @temporalio/* packages from agents and platform
- Temporal server + UI from Docker Compose (saves ~1GB container images)
- Temporal PostgreSQL schema

### Expected Features

**Must have (table stakes):**
- **Declarative agent definitions** (YAML + Markdown) -- industry consensus pattern from Claude Code, CrewAI, OpenAI Agents SDK. Every production framework treats prompts/instructions as first-class configuration, not hardcoded constants.
- **Conversation executor** (start/signal/cancel/get/list API) -- replaces Temporal with Postgres-backed durable execution. Must match or exceed Temporal's guarantees: pause/resume via wait_for tool, full conversation history on resume, deterministic conversation IDs, concurrency control (one loop per conversation), at-least-once execution, timeout enforcement, signal queueing for race conditions.
- **Unified event log** -- append-only event store with tool results (critical gap in v2.2's execution_traces). Event types: tool.called, tool.succeeded, tool.failed, llm.response, agent.started/completed/paused/resumed, signal.received. Session projection reactively updates from events.
- **History management** (tool output pruning + structured summarization) -- every agent gets compaction via config. Phase 1 pruning (keep reasoning, replace tool results with descriptors, deduplicate) handles most cases with zero LLM calls. Phase 2 structured summaries inject ground-truth artifacts from event log projection, preventing drift.
- **Single service consolidating 4 containers** -- agents are config, not services. No production framework deploys separate services per agent type. Single HTTP service with agent registry, tool registry, event router.
- **Signal handling with freeform IncomingEvent shape** -- domain events (approval, pr_merged), not integration-specific payloads. Adapter normalization layer (Slack, GitHub, Linear) transforms webhooks into domain language. Agents never see raw webhook payloads.

**Should have (differentiators):**
- **Event log as single source of truth** (replacing three stores) -- v2.2 has execution_traces (no tool results), tasks (imperatively updated), context_snapshots (lossy summaries). Converging to one event stream eliminates data consistency issues. Neither LangSmith nor Langfuse handle agent state AND observability in one store.
- **Framework-level history management** (not per-agent custom code) -- v2.2 only product agent has compactConversationHistory(). Making compaction a framework concern configured per-agent via history fields is cleaner. Three-phase escalation (prune -> summary -> future agent memory) applies cheapest technique first.
- **Structural race condition fix** (signal queueing) -- v2.2 has retry-with-backoff hack for signals arriving before workflow starts. v2.3 queues signals on conversation record, checks on wait_for. Three states: paused/matching (resume), paused/wrong type (reject), running (queue). No timing-dependent retries.
- **Zero-infrastructure agent addition** -- new agent = new definition directory (YAML + prompt.md). No code changes, no infrastructure changes. The registry picks up new definitions on next access.
- **Domain-language event normalization** -- adapter pattern transforms block_actions.approve to "approval", pull_request.merged to "pr_merged". Agent prompts never mention Slack/GitHub/Linear event structures. Integration-agnostic agent definitions.

**Defer (v2+ or anti-features):**
- Agent-managed memory (MemGPT/Letta style with memory:save/search tools)
- Database-backed agent definitions (admin API, migration tooling)
- Kafka/SQS/EventBridge event log backends
- Cross-agent collaboration (agent-to-agent signaling)
- OpenTelemetry integration
- Real-time streaming dashboard
- Cross-session learning

### Architecture Approach

The core architectural bet: **Postgres is sufficient for Aesir's durability requirements.** Temporal provides enterprise-grade durable execution (replay, distributed task queues, visibility queries), but Aesir uses ~5% of those capabilities. Actual requirements: persist conversation state, route signals to paused conversations, enforce timeouts, detect stale executions, ensure at-least-once processing. Postgres handles all of these with SELECT FOR UPDATE SKIP LOCKED, heartbeat columns, polling-based timeout checks, and row-level locking.

**Major components:**
1. **ConversationExecutor** -- Postgres-backed durable orchestration. Worker polling loop claims queued conversations via SKIP LOCKED, runs agent loop, persists on pause/complete. Heartbeat updates detect stale conversations. Concurrency invariant: exactly one agent loop per conversation at any time.
2. **EventLog** -- append-only Postgres table (agent_events) with buffered batch writes. Events recorded when things happen, not reconstructed afterward. LISTEN/NOTIFY for reactive subscriptions, polling fallback. Sequence per conversation is gapless (use MAX(sequence) + 1 within conversation scope).
3. **SessionProjection** -- reactively updated agent_sessions table subscribing to EventLog. Replaces tasks table with ground-truth artifact extraction (PR numbers, branch names from tool.succeeded events). No more parsePrInfoFromTrace() scanning.
4. **AgentRegistry** -- lazy-loading from definitions/ with mtime-based cache invalidation. Zod validation on load. Version pinning (running conversations stay pinned to definition version they started with).
5. **ToolRegistry** -- factory-based resolution with namespace:tool_name convention (codebase:read_file, linear:get_issue). Each factory receives ToolContext (agentId, correlationId, containerManager) and returns configured ToolDefinition.
6. **EventRouter** -- loads start rules from all registered definitions, matches incoming events. Adapters normalize integration payloads to IncomingEvent objects. Correlation-based signal routing resolves conversation ID from correlation key.
7. **HistoryManager** -- three-phase compaction strategy. Phase 1 (pruning): protect last N messages, replace old tool results with descriptors, deduplicate same-file reads, head+tail preservation. Phase 2 (structured summary): anchored summary with artifact section populated from session projection (ground truth, not LLM memory).

**Critical dependency flow:**
- Agent definition schema -> AgentRegistry + ToolRegistry
- EventLog -> SessionProjection + HistoryManager
- ConversationExecutor depends on: AgentRegistry, ToolRegistry, EventLog, HistoryManager
- EventRouter depends on: AgentRegistry (triggers), ConversationExecutor
- Single service wires all components together

### Critical Pitfalls

1. **JSONB Conversation Messages Becomes Write Amplification Bomb** -- PostgreSQL's MVCC means every UPDATE to messages column rewrites entire JSONB blob. For 500KB conversation, every tool call generates 500KB row rewrite + WAL entry + dead tuple + index updates. TOAST compressed JSONB is 10x slower than inline (7,624ms vs 746ms per 1M row scan). **Prevention:** Persist messages only at lifecycle boundaries (pause/complete/fail), NOT every tool call. During agent loop, messages live in memory only. Consider separate conversation_messages table for append-only INSERTs instead of UPDATE of entire JSONB. Use LZ4 compression. Tune autovacuum aggressively.

2. **Stale Running Conversation Detection Without Proper Heartbeats** -- Agent loops run 5-30 minutes. Process could crash, container OOM-killed, database connection drop. Conversation shows "running" but nothing actually running. Simple timeout causes either killing legitimate slow conversations or leaving abandoned conversations stuck for hours. **Prevention:** Implement heartbeats (onHeartbeat callback updates last_heartbeat_at). Use claimed_by column with worker ID. Separate claiming (short transaction with SKIP LOCKED + SET status = running, COMMIT) from executing agent loop. Use pg_advisory_xact_lock or row-level lock to ensure one process per conversation.

3. **Event Log Sequence Gaps Cause Missed Events** -- PostgreSQL sequences are not transactional. Transaction A gets sequence 5, Transaction B gets sequence 6, B commits first. Projection reads up to sequence 6, records "last processed = 6." Transaction A commits with sequence 5. Projection never sees event 5. **Prevention:** Use gapless sequences per conversation (MAX(sequence) + 1 within conversation scope since one agent loop at a time per conversation). Or use transaction ID-based catchup with pg_current_xact_id(). LISTEN/NOTIFY as hint only, always back with polling. Periodic full reconciliation to catch gaps.

4. **Buffered Event Writes Lose Data on Crash** -- EventLog.append() is void (fire-and-forget). Events buffered in memory and batch-inserted periodically. Process crash between tool call and next flush permanently loses events. Event log cannot be "unified ground truth" AND "fire-and-forget" simultaneously. **Prevention:** Flush events synchronously at lifecycle boundaries (before persisting conversation, before writing session projection, before returning from agent loop). Use WAL-backed buffering (append to local file, replay on crash). Accept tradeoff explicitly (document which event types are "best effort" vs "guaranteed"). Flush on every tool result that produces artifacts.

5. **Signal Arrives Between Agent Loop Exit and Conversation Persist** -- When agent calls wait_for, must: return tool result, exit loop, write agent.paused event, set status to paused, persist conversation, register timeout. Signal arriving between loop exit and persist overwrites queued signal. The v2.2 race condition has merely moved to different window. **Prevention:** Use Postgres row-level locking for conversation updates. Write signal queue separately (signal_inbox table). Atomic transition to paused (single UPDATE with CTE that appends pending signals). Test explicitly (integration test sending signal 0ms after wait_for).

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Database Schema + Core Infrastructure
**Rationale:** Must establish persistence layer before any framework code. Database schema, migrations, and core event logging need to exist before ConversationExecutor or any component that writes to them.
**Delivers:** Postgres schema (conversations, agent_events, agent_sessions tables), Drizzle migrations, EventLog implementation (append/query/flush/subscribe), basic SessionProjection
**Addresses:** CRITICAL-3 (sequence gaps) requires correct schema design upfront. CRITICAL-4 (buffered writes) requires flush policy defined before implementation.
**Avoids:** CRITICAL-1 (JSONB write amplification) via correct messages column strategy (persist only at boundaries, consider separate messages table). MAJOR-6 (MVCC dead tuples) via autovacuum tuning from day one.
**Research flag:** Low -- schema design is well-understood from ARCHITECTURE.md analysis.

### Phase 2: Agent and Tool Registries
**Rationale:** ConversationExecutor depends on AgentRegistry (to load definitions) and ToolRegistry (to resolve tools). These can be built in parallel with database schema but must exist before executor.
**Delivers:** AgentRegistry (lazy loading, mtime caching, Zod validation), ToolRegistry (factory registration, namespace resolution), agent definition files (YAML + prompt.md for dev-agent and product-agent)
**Addresses:** MODERATE-2 (version pinning orphaned definitions) requires version handling in registry design. MINOR-1 (hot reload inconsistency) requires atomic definition loading.
**Uses:** Existing system prompts converted to .md files, existing tool implementations wrapped in factories
**Research flag:** Low -- file loading + caching is standard pattern (ARCHITECTURE.md confirms).

### Phase 3: History Manager
**Rationale:** Can be built in parallel with registries. ConversationExecutor needs it but doesn't depend on registries. Phase 1 pruning is critical for keeping conversation sizes manageable.
**Delivers:** Phase 1 tool output pruning (protect N messages, replace old tool results, deduplicate, head+tail), Phase 2 structured summarization with artifact injection from session projection
**Addresses:** MAJOR-3 (compaction drift) requires careful implementation and testing with real conversations. MODERATE-5 (pruning removes needed info) requires generous protectedMessages config.
**Implements:** Three-phase escalation strategy from FEATURES.md research
**Research flag:** Medium -- Phase 2 summarization needs empirical validation with real dev-agent conversations.

### Phase 4: Conversation Executor (Core)
**Rationale:** This is the Temporal replacement and the highest-complexity component. Requires database schema (Phase 1), registries (Phase 2), and history manager (Phase 3). The critical path bottleneck.
**Delivers:** ConversationExecutor (start/signal/cancel/get/list), worker polling loop with SKIP LOCKED, heartbeat mechanism, stale conversation detection, wait_for tool implementation, concurrency control (one loop per conversation), signal queueing for race condition fix
**Addresses:** CRITICAL-2 (stale detection) is the hardest problem -- requires heartbeats, claimed_by column, atomic claiming. MAJOR-1 (signal race during persist) requires row-level locking and atomic transitions. MAJOR-4 (memory pressure) requires concurrency limits and heap size configuration.
**Uses:** All previous phases (database, registries, history manager)
**Research flag:** High -- most complex component with most critical pitfalls. Needs careful implementation and extensive integration testing.

### Phase 5: Timeout Scheduling
**Rationale:** Depends on ConversationExecutor (delivers timeout signals to conversations). Can be built after core executor works but before event routing (timeout signals are internal, not from webhooks).
**Delivers:** pg-boss integration for timeout scheduling, timeout signal delivery, timeout cancellation on resume
**Addresses:** Part of ConversationExecutor requirement (timeout enforcement). Uses pg-boss startAfter API from STACK.md recommendation.
**Research flag:** Low -- pg-boss is well-documented, timeout pattern is straightforward.

### Phase 6: Event Router + Adapters
**Rationale:** Requires ConversationExecutor to exist (routes events to it). Adapters transform integration payloads. Start rules from agent definitions in registry.
**Delivers:** EventRouter (start rules, signal matching, correlation-based routing), event adapters (Slack, GitHub, Linear payload normalization to IncomingEvent)
**Addresses:** MINOR-2 (signal dedup ID for internal sources) requires adapter implementation. MAJOR-1 (signal race) requires careful signal delivery logic.
**Uses:** AgentRegistry (triggers), ConversationExecutor (start/signal)
**Research flag:** Low -- adapter pattern is well-understood (FEATURES.md validation).

### Phase 7: Single Service Consolidation
**Rationale:** Wires all framework components together. Replaces dev-agent, product-agent, router services with single HTTP service and worker loop.
**Delivers:** Single main.ts service with HTTP routes (/health, /events, /conversations/:id, /conversations/:id/cancel), worker polling loop, graceful shutdown with conversation draining, Docker Compose updates (remove 6 services, add 1)
**Addresses:** MODERATE-3 (graceful shutdown) requires drain logic and stop_grace_period tuning. MODERATE-4 (event table growth) requires retention policy planning.
**Implements:** Bootstrap sequence from ARCHITECTURE.md (env validation -> DB connect -> migrations -> registries -> event log -> session projection -> executor -> router -> HTTP server -> worker loop)
**Research flag:** Low -- mechanical consolidation, HTTP routing is straightforward.

### Phase 8: Smart Router Adaptation
**Rationale:** Existing smart router uses Temporal client. Must adapt to use ConversationExecutor instead. Requires single service (Phase 7) to exist.
**Delivers:** Smart router adapted from Temporal workflowClient to ConversationExecutor, fast-path and slow-path routing unchanged, LLM classification unchanged
**Uses:** ConversationExecutor API instead of Temporal client API
**Research flag:** Low -- wrapper replacement, logic unchanged.

### Phase 9: Integration Testing + Validation
**Rationale:** Before cutover, validate full lifecycle: start -> pause -> signal -> resume -> complete. Test all critical paths and edge cases.
**Delivers:** Integration tests (full dev-agent flow, product-agent flow, signal queueing, timeout enforcement, stale detection), smoke tests with real LLM calls and webhooks
**Addresses:** All critical pitfalls require explicit testing. MAJOR-1 (signal race) needs test sending signal 0ms after wait_for. CRITICAL-2 (stale detection) needs test killing process mid-loop.
**Research flag:** Medium -- integration testing with Docker, webhooks, and LLM calls requires testcontainers setup.

### Phase 10: Temporal Migration + Cutover
**Rationale:** After validation passes, cut over to v2.3. Drain existing Temporal workflows (up to 7 days for workflows waiting on approvals/PR feedback).
**Delivers:** Feature flag (USE_V23_EXECUTOR=true) routing new events to executor, Temporal drain monitoring (verify no running workflows after 7 days), dual-mode signal routing during transition
**Addresses:** MAJOR-5 (Temporal drain long tail) requires migration signals to gracefully terminate waiting workflows, hard cutoff date for forced termination.
**Research flag:** Medium -- drain strategy needs careful execution, dual-mode routing adds complexity.

### Phase 11: Cleanup + Documentation
**Rationale:** After Temporal is fully drained, remove all Temporal code, services, and documentation references.
**Delivers:** Delete packages/agents/src/shared/temporal/, delete per-agent main.ts and worker.ts, remove @temporalio/* from package.json, remove Temporal services from Docker Compose, drop old DB tables (tasks, context_snapshots, execution_traces), update CLAUDE.md
**Research flag:** Low -- mechanical deletion.

### Phase Ordering Rationale

**Why this order:**
- **Database schema first** because everything persists to it. No framework code can exist without schema.
- **Registries next** because they are pure functions (read files, validate, cache) with no external dependencies. Can build in parallel with schema.
- **History manager in parallel** because it only depends on message array format, not on databases or executors.
- **Executor is the critical path** -- most complex component, depends on all previous phases, blocks event routing.
- **Timeout scheduling after core executor** because it delivers signals to executor (internal signal source).
- **Event routing after executor** because it orchestrates start/signal calls to executor (external signal source).
- **Single service consolidation wires everything** -- cannot exist until all framework components exist.
- **Smart router adaptation** is thin wrapper -- quick once single service exists.
- **Integration testing before cutover** -- validate everything works before touching production.
- **Temporal migration last** -- only after v2.3 is fully validated.

**Why this grouping:**
- **Phases 1-3 are foundational infrastructure** (database, registries, compaction) that can be built in parallel with careful coordination.
- **Phase 4 is the executor** (critical path, blocks everything downstream).
- **Phases 5-6 are signal sources** (timeout scheduler, event router) that deliver events to executor.
- **Phase 7 is integration** (wiring all components into single service).
- **Phases 8-9 are adaptation and validation** (prepare for cutover).
- **Phases 10-11 are migration and cleanup** (replace Temporal, remove old code).

**How this avoids pitfalls:**
- **CRITICAL-1 (JSONB write amplification)** addressed in Phase 1 (schema design before any code).
- **CRITICAL-2 (stale detection)** addressed in Phase 4 (heartbeat implementation required for executor).
- **CRITICAL-3 (sequence gaps)** addressed in Phase 1 (gapless sequence strategy in schema).
- **CRITICAL-4 (buffered writes data loss)** addressed in Phase 1 (flush policy defined before EventLog implementation).
- **MAJOR-1 (signal race)** addressed in Phase 4 (atomic persist) and Phase 6 (signal delivery logic).
- **MAJOR-3 (compaction drift)** addressed in Phase 3 (history manager with testing before integration).
- **MAJOR-5 (Temporal drain)** addressed in Phase 10 (explicit migration strategy, not assumed).
- **MAJOR-6 (MVCC dead tuples)** addressed in Phase 1 (autovacuum tuning in schema setup).

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 4 (ConversationExecutor)** -- most critical component with most pitfalls. Needs detailed implementation research for heartbeat mechanism, atomic claiming, signal queueing. Consider dedicated research-phase call before implementation.
- **Phase 9 (Integration Testing)** -- testcontainers setup for Docker-based testing, webhook simulation, real LLM call mocking. May need research on testing patterns for long-running agent loops.
- **Phase 10 (Temporal Migration)** -- drain strategy needs validation. Consider research on Temporal workflow inspection/migration patterns.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Database Schema)** -- Drizzle ORM schema definition is well-understood from existing codebase patterns.
- **Phase 2 (Registries)** -- file loading + caching is straightforward pattern.
- **Phase 5 (Timeout Scheduling)** -- pg-boss integration is well-documented.
- **Phase 6 (Event Router)** -- adapter pattern is well-established.
- **Phase 7 (Single Service)** -- HTTP server consolidation is mechanical.
- **Phase 8 (Smart Router Adaptation)** -- wrapper replacement.
- **Phase 11 (Cleanup)** -- code deletion.

**Phase 3 (History Manager) is borderline** -- Phase 1 pruning is standard (well-researched), Phase 2 summarization may benefit from targeted research on Claude API prompting for structured summaries.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Custom SKIP LOCKED pattern verified across pg-boss, Solid Queue, DBOS, Inngest. pg-boss for timeouts is correct tool for the job. Event log as Postgres table is well-established. JSONB for conversation history is acceptable given write-rarely pattern. All stack decisions backed by production implementations. |
| Features | **HIGH** | Every table stakes feature validated against production frameworks (Claude Code, OpenAI Agents SDK, CrewAI, AutoGen, LangGraph). Feature dependencies clearly mapped. MVP scope well-defined with explicit anti-features list. Differentiators are architectural consequences, not separate features. |
| Architecture | **HIGH** (custom build) / **MEDIUM** (external patterns) | ConversationExecutor pattern is well-documented (pg-boss, Solid Queue, DBOS). Event log integration with Drizzle is standard. Single service consolidation is straightforward. JSONB performance analysis is theoretical (not load-tested with Aesir data). History compaction has documented failure modes (Claude Code issues). |
| Pitfalls | **HIGH** | All critical pitfalls sourced from production post-mortems (Brandur's Postgres queues, pganalyze JSONB benchmarks, Claude Code compaction failures, Event-Driven.io sequence gaps). Mitigation strategies validated across multiple sources. Phase-specific warnings mapped to implementation phases. |

**Overall confidence:** **HIGH**

Research is comprehensive with cross-verification across multiple production systems. The core technical bet (Postgres as durable executor) is validated by pg-boss (215K weekly downloads), Solid Queue (Rails production usage), and DBOS (VC-backed company built entirely on this pattern). All critical pitfalls have documented mitigations from real-world implementations.

### Gaps to Address

**Areas where research was inconclusive or needs validation during implementation:**

- **Actual conversation memory footprint in Node.js** -- MAJOR-4 estimates 500KB-5MB per conversation but needs measurement with real Anthropic SDK payloads. Profile memory during real dev-agent conversation before setting concurrency limits. **Resolution:** Phase 9 integration testing includes memory profiling.

- **Optimal event buffer flush interval** -- CRITICAL-4 prevention requires balancing performance (too frequent = overhead) vs data loss risk (too infrequent = loss). **Resolution:** Start with conservative 1-second flush, benchmark during Phase 1 EventLog implementation, tune based on observed event volumes.

- **History compaction trigger thresholds** -- Spec says 80K tokens for pruning, 120K for summarization. Needs empirical validation with real dev-agent conversations. **Resolution:** Phase 3 history manager includes testing with saved v2.2 conversation histories. Adjust thresholds based on observed behavior.

- **Worker polling interval** -- Trade-off between responsiveness (5s = responsive signal delivery) and database load (5s = ~12 queries/minute). **Resolution:** Start with 5-second interval as recommended in ARCHITECTURE.md, monitor pg_stat_user_tables for query load, adjust if needed.

- **Conversation cleanup policy** -- When should completed conversations be archived? Spec mentions retention but no specific policy. Without cleanup, conversations table grows indefinitely. **Resolution:** Define retention policy in Phase 1 schema design. Recommend 30-day retention with monthly partitioning.

- **Sub-agent persistence strategy** -- Spec says sub-agents "run inline" but if a sub-agent runs 10+ minutes, its state is at risk on process crash. **Resolution:** Clarify in Phase 4 ConversationExecutor design. Recommendation: sub-agents inherit parent conversation's persistence (saved on parent pause/complete).

- **Dual-mode routing during Temporal transition** -- Phase 10 requires routing signals to correct system (Temporal vs v2.3) during drain period. **Resolution:** Design signal router version check in Phase 10 planning. Check both Temporal (via workflow client) and v2.3 (via conversation ID lookup) for each signal.

## Sources

### Primary (HIGH confidence)

**Stack Research:**
- [Graphile Worker GitHub](https://github.com/graphile/worker) -- MIT, SKIP LOCKED implementation
- [pg-boss GitHub](https://github.com/timgit/pg-boss) -- MIT, 12.8.0, 215K weekly downloads
- [DBOS: Postgres for Everything](https://www.dbos.dev/blog/postgres-durable-execution) -- SELECT FOR UPDATE SKIP LOCKED pattern
- [Solid Queue (Rails)](https://github.com/rails/solid_queue) -- Postgres job queue with heartbeat pattern
- [PostgreSQL JSONB TOAST Performance](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) -- 2KB threshold, 10x slowdown benchmarks
- [Anthropic Context Compaction Cookbook](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction) -- compaction_control API

**Features Research:**
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/agents/) -- Agent class API, session persistence
- [CrewAI YAML Configuration](https://deepwiki.com/crewAIInc/crewAI/8.2-yaml-configuration) -- Declarative agents.yaml
- [Claude Code Custom Subagents](https://code.claude.com/docs/en/sub-agents) -- YAML frontmatter + Markdown
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) -- Checkpoint-based state
- [LangSmith Tracing](https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747) -- Run Tree model
- [Langfuse Data Model](https://langfuse.com/docs/observability/data-model) -- Traces/observations/events

**Architecture Research:**
- Codebase analysis (orchestrator-workflow.ts, run-agent-loop.ts, schema.ts, docker-compose.yml) -- Current v2.2 architecture
- v2.3 spec (2.3-spec.md, 1712 lines) -- Target architecture
- [Armin Ronacher: Postgres Workflows](https://lucumr.pocoo.org/2024/11/18/absurd-workflows/) -- Postgres-as-job-queue patterns
- Drizzle ORM documentation -- LISTEN/NOTIFY gap, batch insert patterns

**Pitfalls Research:**
- [Brandur: Postgres Job Queues & Failure By MVCC](https://brandur.org/postgres-queues) -- Dead tuple accumulation
- [Event-Driven.io: Postgres Sequences Issues](https://event-driven.io/en/ordering_in_postgres_outbox/) -- Sequence gap problem
- [Recall.ai: LISTEN/NOTIFY Does Not Scale](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale) -- Notification limitations
- [Claude Code Issue #18211, #19739, #5677](https://github.com/anthropics/claude-code/issues/) -- Compaction failure modes
- [Evan Jones: Large JSON Performance](https://www.evanjones.ca/postgres-large-json-performance.html) -- JSONB benchmarks

### Secondary (MEDIUM confidence)

- [Context Compaction Research (Gist)](https://gist.github.com/martinec/0d078c88b0bdc97fea21fc6d7d596af8) -- Claude Code, OpenCode, Amp comparison
- [Confluent: Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) -- Orchestrator-worker patterns
- [AWS Routing Dynamic Dispatch](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/routing-dynamic-dispatch-patterns.html) -- EventBridge-based routing
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) -- Dispatcher, pipeline patterns

### Tertiary (LOW confidence)

- [Long Quanzheng: Workflow Should Be Code](https://medium.com/@qlong/workflow-should-be-code-but-durable-execution-is-not-the-only-way-519f7682360c) -- Custom workflow engine pitfalls (anecdotal)

---
*Research completed: 2026-02-01*
*Ready for roadmap: yes*
