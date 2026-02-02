# Requirements: Aesir v2.3 Unified Agent Framework

**Defined:** 2026-02-01
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v2.3 Requirements

Requirements for v2.3 milestone. Each maps to roadmap phases starting at Phase 37.

### Agent Definition

- [x] **DEF-01**: Agents defined via YAML config + prompt.md files (not hardcoded orchestrator code)
- [x] **DEF-02**: YAML schema validated with Zod on load (fail fast on invalid definitions)
- [x] **DEF-03**: System prompt loaded from separate Markdown file referenced in YAML
- [x] **DEF-04**: Agent definition includes model, tools, maxIterations, tokenBudget, history config
- [x] **DEF-05**: Agent definition includes trigger rules for event routing (which events start this agent)
- [x] **DEF-06**: Sub-agent definitions referenced by ID in parent agent config
- [x] **DEF-07**: dev-agent and product-agent converted from hardcoded code to declarative definitions
- [x] **DEF-08**: Sub-agents (researcher, coder, tester) converted to declarative definitions

### Event Log

- [x] **EVT-01**: Append-only agent_events table with conversation-scoped gapless sequences
- [x] **EVT-02**: Event types: tool.called, tool.succeeded, tool.failed, llm.response, agent.started, agent.completed, agent.paused, agent.resumed, signal.received
- [x] **EVT-03**: Buffered writes with configurable flush interval
- [x] **EVT-04**: Synchronous flush at lifecycle boundaries (pause, complete, fail) — no data loss on crash
- [x] **EVT-05**: agent_sessions projection table reactively updated from events (artifacts, status, timing)
- [x] **EVT-06**: Session projection extracts ground-truth artifacts (PR URLs, branch names) from tool.succeeded events
- [ ] **EVT-07**: Replaces three disconnected stores: execution_traces, tasks, context_snapshots

### Conversation Executor

- [x] **EXEC-01**: ConversationExecutor with start(), signal(), get(), cancel(), list() API
- [x] **EXEC-02**: Worker loop claims queued conversations with concurrency-safe locking (exactly one claimer per conversation)
- [x] **EXEC-03**: Conversation messages persisted by the executor — persistence strategy is an implementation decision behind the ConversationExecutor interface
- [x] **EXEC-04**: Heartbeat mechanism detects running conversations during agent loop execution
- [x] **EXEC-05**: Stale conversation detection — re-enqueue conversations with expired heartbeats
- [x] **EXEC-06**: Concurrency invariant: exactly one agent loop per conversation at any time
- [x] **EXEC-07**: wait_for tool that pauses conversation and registers expected signal type
- [x] **EXEC-08**: Signal queueing — signals arriving while conversation is running are queued and checked on next wait_for
- [x] **EXEC-09**: Deterministic conversation IDs from agent definition + correlation key
- [x] **EXEC-10**: Idempotent start — duplicate start calls for same conversation ID are no-ops
- [x] **EXEC-11**: At-least-once execution guarantee (failed/crashed conversations re-enqueued)

### History Management

- [x] **HIST-01**: Phase 1 pruning: protect last N messages, replace old tool results with descriptors
- [x] **HIST-02**: Phase 1 pruning: deduplicate consecutive same-file reads, head+tail preservation for large outputs
- [x] **HIST-03**: Phase 2 structured summarization: replace oldest section with anchored summary
- [x] **HIST-04**: Phase 2 summaries inject ground-truth artifacts from session projection (not LLM memory)
- [x] **HIST-05**: History config per agent definition (protectedMessages, pruningThreshold, summaryThreshold)
- [x] **HIST-06**: Framework-level compaction (not per-agent custom code) — all agents get compaction via config

### Registries

- [x] **REG-01**: AgentRegistry loads definitions from definitions/ directory with lazy loading
- [x] **REG-02**: AgentRegistry uses mtime-based cache invalidation for definition changes
- [x] **REG-03**: ToolRegistry with factory-based registration and namespace:tool_name resolution
- [x] **REG-04**: Tool factories receive ToolContext (agentId, correlationId, containerManager) and return configured tools
- [x] **REG-05**: Running conversations pinned to definition version they started with
- [x] **REG-06**: New agent = new definition directory — zero code changes, zero infrastructure changes

### Signal Handling

- [x] **SIG-01**: Event adapters normalize webhook payloads to domain-language IncomingEvent types
- [x] **SIG-02**: Three adapters: Slack, GitHub, Linear (transform raw webhooks to approval, pr_merged, etc.)
- [x] **SIG-03**: EventRouter loads start rules from registered agent definitions
- [x] **SIG-04**: Correlation-based signal routing resolves conversation ID from correlation key
- [ ] **SIG-05**: Fast-path routing preserved for unambiguous events (deterministic, no LLM needed)
- [ ] **SIG-06**: Smart router adapted from Temporal workflowClient to ConversationExecutor
- [ ] **SIG-07**: Signal deduplication — duplicate signals (webhook retries) are no-ops, tracked by source + delivery ID on conversation

### Service Consolidation

- [ ] **SVC-01**: Single HTTP service replacing dev-agent:3004, product-agent:3005, router:3006
- [ ] **SVC-02**: Unified /events endpoint receiving all webhook-routed events
- [ ] **SVC-03**: /conversations/:id and /conversations/:id/cancel management endpoints
- [ ] **SVC-04**: Worker polling loop integrated into same process as HTTP server
- [ ] **SVC-05**: Graceful shutdown with conversation draining (finish running loops before exit)
- [ ] **SVC-06**: Docker Compose updated — remove Temporal server, Temporal UI, per-agent services

### Timeout Scheduling

- [x] **TMO-01**: Delayed signal delivery for timeout enforcement (e.g., "wake in 72 hours")
- [x] **TMO-02**: Timeout cancellation on conversation resume (prevent stale timeout signals)
- [x] **TMO-03**: Timeout signals delivered through same signal pathway as external events

### Migration

- [ ] **MIG-01**: Feature flag (USE_V23_EXECUTOR) routing new events to ConversationExecutor
- [ ] **MIG-02**: Temporal drain period — existing workflows complete naturally (up to 7 days)
- [ ] **MIG-03**: Delete packages/agents/src/shared/temporal/ after drain completes
- [ ] **MIG-04**: Remove all @temporalio/* dependencies from package.json
- [ ] **MIG-05**: Delete per-agent main.ts, worker.ts, and api/ directories
- [ ] **MIG-06**: Drop old database tables (tasks, context_snapshots, execution_traces)
- [ ] **MIG-07**: Update CLAUDE.md to reflect v2.3 architecture (remove all Temporal/LangGraph references)

## Deferred Requirements

Acknowledged but not in v2.3 scope. Tracked for future milestones.

### Future Agent Capabilities

- **FUT-01**: Agent-managed memory (MemGPT/Letta style with memory:save/search tools)
- **FUT-02**: Cross-agent collaboration (dev agent asks product agent to clarify mid-task)
- **FUT-03**: Cross-session learning (agents improve from past task outcomes)
- **FUT-04**: Database-backed agent definitions with admin API

### Future Infrastructure

- **FUT-05**: Kafka/SQS/EventBridge event log backends (scale beyond Postgres)
- **FUT-06**: OpenTelemetry integration for distributed tracing
- **FUT-07**: Real-time streaming dashboard for conversation monitoring
- **FUT-08**: LISTEN/NOTIFY for event-driven worker wakeup (replace polling)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Full event sourcing library | Append-only store with ~200 lines is sufficient; library adds complexity without benefit |
| UI for agent definition management | Code/config first philosophy; file-based definitions are sufficient |
| Streaming LLM responses | Non-streaming is appropriate for backend agents; streaming adds complexity without benefit |
| Parallel sub-agents | Sequential sub-agent execution is sufficient; parallel adds concurrency complexity |

**Implementation note:** v2.3 uses PostgreSQL as the backing store for all interfaces (EventLog, ConversationExecutor, SessionProjection). This is a convenience decision — Postgres is already in the stack and handles Aesir's current scale. The interfaces are designed to be backing-store agnostic; if a different technology makes sense for a subsystem later, the abstraction accommodates it.

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVT-01 | Phase 37 | Complete |
| EVT-02 | Phase 37 | Complete |
| EVT-03 | Phase 37 | Complete |
| EVT-04 | Phase 37 | Complete |
| EVT-05 | Phase 37 | Complete |
| EVT-06 | Phase 37 | Complete |
| EVT-07 | Phase 47 | Pending |
| DEF-01 | Phase 38 | Complete |
| DEF-02 | Phase 38 | Complete |
| DEF-03 | Phase 38 | Complete |
| DEF-04 | Phase 38 | Complete |
| DEF-05 | Phase 38 | Complete |
| DEF-06 | Phase 38 | Complete |
| DEF-07 | Phase 38 | Complete |
| DEF-08 | Phase 38 | Complete |
| REG-01 | Phase 38 | Complete |
| REG-02 | Phase 38 | Complete |
| REG-03 | Phase 38 | Complete |
| REG-04 | Phase 38 | Complete |
| REG-05 | Phase 38 | Complete |
| REG-06 | Phase 38 | Complete |
| HIST-01 | Phase 39 | Complete |
| HIST-02 | Phase 39 | Complete |
| HIST-03 | Phase 39 | Complete |
| HIST-04 | Phase 39 | Complete |
| HIST-05 | Phase 39 | Complete |
| HIST-06 | Phase 39 | Complete |
| EXEC-01 | Phase 40 | Complete |
| EXEC-02 | Phase 40 | Complete |
| EXEC-03 | Phase 40 | Complete |
| EXEC-04 | Phase 40 | Complete |
| EXEC-05 | Phase 40 | Complete |
| EXEC-06 | Phase 40 | Complete |
| EXEC-07 | Phase 40 | Complete |
| EXEC-08 | Phase 40 | Complete |
| EXEC-09 | Phase 40 | Complete |
| EXEC-10 | Phase 40 | Complete |
| EXEC-11 | Phase 40 | Complete |
| TMO-01 | Phase 41 | Complete |
| TMO-02 | Phase 41 | Complete |
| TMO-03 | Phase 41 | Complete |
| SIG-01 | Phase 42 | Complete |
| SIG-02 | Phase 42 | Complete |
| SIG-03 | Phase 42 | Complete |
| SIG-04 | Phase 42 | Complete |
| SIG-05 | Phase 43 | Pending |
| SIG-06 | Phase 43 | Pending |
| SIG-07 | Phase 40 | Pending |
| SVC-01 | Phase 44 | Pending |
| SVC-02 | Phase 44 | Pending |
| SVC-03 | Phase 44 | Pending |
| SVC-04 | Phase 44 | Pending |
| SVC-05 | Phase 44 | Pending |
| SVC-06 | Phase 47 | Pending |
| MIG-01 | Phase 46 | Pending |
| MIG-02 | Phase 46 | Pending |
| MIG-03 | Phase 47 | Pending |
| MIG-04 | Phase 47 | Pending |
| MIG-05 | Phase 47 | Pending |
| MIG-06 | Phase 47 | Pending |
| MIG-07 | Phase 47 | Pending |

**Coverage:**
- v2.3 requirements: 58 total
- Mapped to phases: 58
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-01*
*Last updated: 2026-02-02 -- Phase 42 complete (SIG-01 through SIG-04)*
