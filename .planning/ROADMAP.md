# Roadmap: Aesir v2.3 Unified Agent Framework

## Overview

v2.3 replaces Temporal workflow orchestration, per-agent services, and fragmented persistence with a Postgres-backed conversation executor, declarative agent definitions, and a unified event log. The milestone progresses from persistence foundations (schema, registries, history) through the critical-path executor, to signal routing, service consolidation, and finally Temporal migration and cleanup. Phases 37-47 continue from v2.2's Phase 36.

## Milestones

- v1 MVP - Phases 1-9 (shipped 2026-01-19)
- v2.0 Foundation - Phases 10-22 (shipped 2026-01-25)
- v2.1 Agents That Ship - Phases 23-27 (shipped 2026-01-28)
- v2.2 Agentic Architecture - Phases 28-36 (shipped 2026-01-31)
- **v2.3 Unified Agent Framework** - Phases 37-47 (in progress)

## Phases

- [ ] **Phase 37: Database Schema + Event Log Core** - Persistence layer for conversations, events, and session projections
- [ ] **Phase 38: Agent and Tool Registries** - Declarative agent definitions loaded from YAML + prompt.md with factory-based tool resolution
- [ ] **Phase 39: History Manager** - Three-phase conversation compaction with tool pruning and structured summarization
- [ ] **Phase 40: Conversation Executor** - Postgres-backed durable executor replacing Temporal workflows
- [ ] **Phase 41: Timeout Scheduling** - pg-boss integration for delayed signal delivery
- [ ] **Phase 42: Event Router + Adapters** - Webhook normalization to domain events with correlation-based signal routing
- [ ] **Phase 43: Smart Router Adaptation** - Adapt existing smart router from Temporal client to ConversationExecutor
- [ ] **Phase 44: Single Service Consolidation** - One HTTP service replacing dev-agent, product-agent, and router services
- [ ] **Phase 45: Integration Testing + Validation** - Full lifecycle testing of start, pause, signal, resume, complete flows
- [ ] **Phase 46: Temporal Migration + Cutover** - Feature flag cutover with Temporal drain period
- [ ] **Phase 47: Cleanup + Documentation** - Remove Temporal code, old persistence stores, and update documentation

## Phase Details

### Phase 37: Database Schema + Event Log Core
**Goal**: Establish the persistence layer that all framework components write to -- conversations table, agent_events table, agent_sessions projection, and EventLog implementation
**Depends on**: Nothing (first phase of v2.3)
**Requirements**: EVT-01, EVT-02, EVT-03, EVT-04, EVT-05, EVT-06
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Drizzle migration creates conversations, agent_events, and agent_sessions tables in a new schema
  2. EventLog appends events with gapless per-conversation sequences and correct event types (tool.called, tool.succeeded, tool.failed, llm.response, agent.started, agent.completed, agent.paused, agent.resumed, signal.received)
  3. Buffered batch INSERT flushes events at configurable intervals, with synchronous flush at lifecycle boundaries (pause, complete, fail)
  4. agent_sessions projection reactively updates status, timing, and ground-truth artifacts (PR URLs, branch names) extracted from tool.succeeded events
**Plans**: TBD

### Phase 38: Agent and Tool Registries
**Goal**: Agents defined as YAML config + prompt.md files loaded by registries, with factory-based tool resolution -- adding a new agent requires only a new definition directory
**Depends on**: Nothing (can build in parallel with Phase 37)
**Requirements**: DEF-01, DEF-02, DEF-03, DEF-04, DEF-05, DEF-06, DEF-07, DEF-08, REG-01, REG-02, REG-03, REG-04, REG-05, REG-06
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Agent definitions loaded from definitions/ directory as YAML (validated by Zod on load) with system prompts in separate Markdown files
  2. YAML schema includes model, tools, maxIterations, tokenBudget, history config, trigger rules, and sub-agent references
  3. dev-agent, product-agent, and sub-agents (researcher, coder, tester) exist as declarative definitions replacing hardcoded orchestrator code
  4. ToolRegistry resolves tools by namespace:tool_name convention via factory functions that receive ToolContext (agentId, correlationId, containerManager)
  5. AgentRegistry uses mtime-based cache invalidation, and running conversations remain pinned to the definition version they started with
**Plans**: TBD

### Phase 39: History Manager
**Goal**: Framework-level conversation compaction that all agents get via config -- Phase 1 pruning replaces old tool outputs with descriptors, Phase 2 structured summarization injects ground-truth artifacts
**Depends on**: Phase 37 (needs agent_sessions projection for artifact injection in Phase 2 summaries)
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04, HIST-05, HIST-06
**Risk**: MEDIUM (summarization thresholds need empirical validation)
**Research**: needs-research (Phase 2 summarization prompting and threshold tuning)
**Success Criteria** (what must be TRUE):
  1. Phase 1 pruning protects last N messages, replaces old tool results with descriptors, deduplicates consecutive same-file reads, and preserves head+tail for large outputs
  2. Phase 2 structured summarization replaces the oldest message section with an anchored summary that includes ground-truth artifacts from the session projection (not LLM memory)
  3. History config (protectedMessages, pruningThreshold, summaryThreshold) is set per agent definition, and every agent gets compaction through config without custom code
**Plans**: TBD

### Phase 40: Conversation Executor
**Goal**: Durable conversation executor that replaces Temporal workflows -- worker loop claims conversations with concurrency-safe locking, agents pause via wait_for tool, signals resume matching conversations, with at-least-once execution and crash recovery
**Depends on**: Phase 37 (database), Phase 38 (registries), Phase 39 (history manager)
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05, EXEC-06, EXEC-07, EXEC-08, EXEC-09, EXEC-10, EXEC-11
**Risk**: HIGH (critical path, most complex component, most pitfalls -- write amplification, stale detection, signal races)
**Research**: needs-research (heartbeat mechanism, atomic claiming, signal queueing, race condition prevention)
**Success Criteria** (what must be TRUE):
  1. ConversationExecutor exposes start(), signal(), get(), cancel(), list() API and worker loop claims queued conversations with concurrency-safe locking
  2. Conversation messages persisted by the executor -- persistence strategy is an implementation decision behind the interface
  3. wait_for tool pauses the conversation and registers the expected signal type; signals arriving while conversation is running are queued and checked on next wait_for
  4. Heartbeat mechanism (last_heartbeat_at updated during execution) detects stale conversations and re-enqueues them; concurrency invariant enforced so exactly one agent loop runs per conversation at any time
  5. Deterministic conversation IDs from agent definition + correlation key; duplicate start() calls for the same conversation ID are idempotent no-ops; failed/crashed conversations are re-enqueued for at-least-once execution
**Plans**: TBD

### Phase 41: Timeout Scheduling
**Goal**: Delayed signal delivery to conversations (e.g., "wake in 72 hours") through the same signal pathway as external events
**Depends on**: Phase 40 (executor -- delivers timeout signals to conversations)
**Requirements**: TMO-01, TMO-02, TMO-03
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Delayed signal delivery (e.g., timeout after 72 hours) wakes paused conversations
  2. Timeout signals are delivered through the same signal pathway as external events (no separate handling)
  3. Timeouts are cancelled when a conversation resumes before the timeout fires (preventing stale timeout signals)
**Plans**: TBD

### Phase 42: Event Router + Adapters
**Goal**: Adapter pattern normalizes raw webhook payloads from Slack, GitHub, and Linear into domain-language IncomingEvent types, and the EventRouter matches events against agent trigger rules for start or correlation-based signal delivery
**Depends on**: Phase 38 (agent definitions for trigger rules), Phase 40 (executor for start/signal)
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Three adapters (Slack, GitHub, Linear) normalize raw webhook payloads into domain-language IncomingEvent types (e.g., block_actions.approve becomes "approval", pull_request.merged becomes "pr_merged")
  2. EventRouter loads start rules from registered agent definitions and starts new conversations for matching events
  3. Correlation-based signal routing resolves conversation ID from correlation key and delivers signals to paused conversations
**Plans**: TBD

### Phase 43: Smart Router Adaptation
**Goal**: Existing smart router works against ConversationExecutor instead of Temporal workflowClient, preserving fast-path deterministic routing and slow-path LLM classification
**Depends on**: Phase 40 (executor), Phase 42 (event router)
**Requirements**: SIG-05, SIG-06
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Fast-path routing preserved for unambiguous events (deterministic, no LLM call needed)
  2. Smart router calls ConversationExecutor.start() and ConversationExecutor.signal() instead of Temporal workflowClient -- same classification logic, different target
**Plans**: TBD

### Phase 44: Single Service Consolidation
**Goal**: One HTTP service replaces dev-agent:3004, product-agent:3005, and router:3006 -- with unified /events endpoint, management endpoints, integrated worker loop, and graceful shutdown
**Depends on**: Phase 37, Phase 38, Phase 39, Phase 40, Phase 41, Phase 42, Phase 43 (all framework components)
**Requirements**: SVC-01, SVC-02, SVC-03, SVC-04, SVC-05
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Single HTTP service runs on one port with /events endpoint receiving all webhook-routed events
  2. /conversations/:id and /conversations/:id/cancel management endpoints are available
  3. Worker polling loop runs integrated in the same process as the HTTP server
  4. Graceful shutdown drains running conversations (finishes current loops before exit)
**Plans**: TBD

### Phase 45: Integration Testing + Validation
**Goal**: Full lifecycle testing validates the complete flow -- start conversation, pause via wait_for, deliver signal, resume, complete -- plus edge cases (stale detection, signal queueing, timeout enforcement)
**Depends on**: Phase 44 (single service -- all components wired together)
**Requirements**: (cross-cutting validation of all v2.3 requirements)
**Risk**: MEDIUM
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. Integration test demonstrates full dev-agent lifecycle: webhook event starts conversation, agent pauses for approval via wait_for, approval signal resumes conversation, agent completes and artifacts are recorded in session projection
  2. Integration test demonstrates full product-agent lifecycle: Slack message starts conversation, agent gathers requirements, creates Linear issue, completes
  3. Edge case tests pass: signal arriving while conversation is running is queued and delivered on next wait_for; stale conversation with expired heartbeat is re-enqueued; timeout fires and wakes paused conversation
  4. All existing test suites continue to pass (no regressions from v2.2)
**Plans**: TBD

### Phase 46: Temporal Migration + Cutover
**Goal**: Feature flag routes new events to ConversationExecutor while existing Temporal workflows drain naturally over a 7-day window
**Depends on**: Phase 45 (validation passing)
**Requirements**: MIG-01, MIG-02
**Risk**: MEDIUM
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. USE_V23_EXECUTOR feature flag routes all new events to ConversationExecutor when enabled
  2. Existing Temporal workflows continue to receive signals and complete naturally during the drain period (up to 7 days)
  3. After drain period, zero Temporal workflows remain running
**Plans**: TBD

### Phase 47: Cleanup + Documentation
**Goal**: Remove all Temporal code, services, Docker containers, database tables, and dependencies -- update documentation to reflect v2.3 architecture
**Depends on**: Phase 46 (drain complete)
**Requirements**: EVT-07, SVC-06, MIG-03, MIG-04, MIG-05, MIG-06, MIG-07
**Risk**: LOW
**Research**: standard-pattern
**Success Criteria** (what must be TRUE):
  1. packages/agents/src/shared/temporal/ directory deleted, all @temporalio/* dependencies removed from package.json
  2. Per-agent main.ts, worker.ts, and api/ directories deleted
  3. Old database tables (tasks, context_snapshots, execution_traces) dropped via migration; three disconnected stores replaced by unified event log
  4. Docker Compose updated -- Temporal server, Temporal UI, and per-agent services removed; single agent service added
  5. CLAUDE.md updated to reflect v2.3 architecture (no Temporal/LangGraph references remain)
**Plans**: TBD

## Progress

**Execution Order:** 37 -> 38 -> 39 -> 40 -> 41 -> 42 -> 43 -> 44 -> 45 -> 46 -> 47

Note: Phases 37 and 38 have no dependency on each other and could execute in parallel. Phase 39 depends only on Phase 37. All three feed into Phase 40 (the critical path).

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 37. Database Schema + Event Log Core | 0/TBD | Not started | - |
| 38. Agent and Tool Registries | 0/TBD | Not started | - |
| 39. History Manager | 0/TBD | Not started | - |
| 40. Conversation Executor | 0/TBD | Not started | - |
| 41. Timeout Scheduling | 0/TBD | Not started | - |
| 42. Event Router + Adapters | 0/TBD | Not started | - |
| 43. Smart Router Adaptation | 0/TBD | Not started | - |
| 44. Single Service Consolidation | 0/TBD | Not started | - |
| 45. Integration Testing + Validation | 0/TBD | Not started | - |
| 46. Temporal Migration + Cutover | 0/TBD | Not started | - |
| 47. Cleanup + Documentation | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-01*
*Last updated: 2026-02-01*
