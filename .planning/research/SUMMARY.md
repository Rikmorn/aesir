# Project Research Summary

**Project:** Aesir v2.7 Agent Collaboration
**Domain:** Multi-agent collaboration features for agentic development platform
**Researched:** 2026-02-10
**Confidence:** HIGH

## Executive Summary

v2.7 adds multi-agent collaboration to Aesir's proven isolated-conversation architecture. The research reveals a sobering reality: multi-agent LLM systems fail at 41-86.7% rates in production, primarily due to specification and coordination failures (79% combined), not infrastructure problems. The biggest risk is not building the wrong infrastructure -- it's breaking the reliable single-agent workflows that work today.

The recommended approach follows Aesir's agent-first philosophy: extend, don't restructure. All collaboration capabilities integrate into the existing `@aesir/agents` package via new tables in the `agents.*` schema, new tool namespaces, and new services following the established factory pattern. No new packages or worker processes. The architecture uses three proven patterns: (1) pgvector in PostgreSQL for semantic search (knowledge + directory), avoiding separate vector databases; (2) signal-based inter-conversation communication building on the existing `wait_for` + signal infrastructure; (3) task-lifecycle-driven event dispatch via EventEmitter pattern.

Key risks center on delegation complexity and completion signaling. The critical failure modes are: completion signals lost to terminal conversations (orphaned results), delegation depth explosion creating management-layer anti-patterns, circular waits causing deadlocks, and shared memory poisoning from stale knowledge. These risks are mitigated through architectural guardrails (depth limits, multi-type wait_for, mandatory expiry on knowledge), not prompt engineering alone. The spec's graceful degradation principle -- "collaboration enhances, isolation still works" -- must be enforced: every collaboration tool failure should return structured errors, never crash the agent loop.

## Key Findings

### Recommended Stack

Five new npm dependencies and one Docker image swap. All additions are well-established in production: pgvector is the standard Postgres extension for vector search; Voyage AI is Anthropic's official embedding recommendation; @xyflow/react is the industry standard for React graph visualization. The only medium-confidence area is Linear's Agent SDK (developer preview as of July 2025), which requires feature flags for fallback.

**Core technologies:**
- **@linear/sdk ^75.0.0** — Agent activity API, replacing comments with typed activities (thought/elicitation/action/response/error). Eliminates echo filtering entirely via `actor=app` identity. Developer preview status warrants feature flag.
- **pgvector/pgvector:pg15 Docker image** — Replaces postgres:15-alpine to add pgvector extension. Drop-in replacement; existing volumes compatible. Enables semantic search for knowledge store and entity directory without separate vector database.
- **voyageai ^0.1.0** — Embedding generation via Anthropic's recommended provider. 1024-dimension output matches pgvector schema. Chosen over OpenAI for vendor alignment; local embeddings rejected due to infrastructure overhead.
- **@xyflow/react ^12.10.0 + @dagrejs/dagre ^2.0.3** — Delegation graph visualization in dashboard. React Flow is industry standard (23K stars); dagre provides hierarchical layout. 30KB bundle vs 400KB for elkjs alternative.
- **pgvector ^0.2.0 npm package** — Type registration for node-postgres driver. Works with existing Drizzle ORM pgvector support (built-in since v0.28.0).

**Critical version notes:**
- @linear/sdk must be ^75.0.0 for agent activity methods (published 2026-02-10)
- Linear refresh token migration required before April 1, 2026 (breaking change)
- Postgres 15+ required for pgvector (already met)

### Expected Features

Research across CrewAI, LangGraph, AutoGen, A2A protocol, and Linear Agent SDK reveals clear table stakes vs. genuine differentiators. The delegation handshake negotiation (accept/reject/counter-propose) is novel -- no mainstream framework implements it. This is a differentiator but also higher risk due to lack of proven patterns.

**Must have (table stakes):**
- **Task delegation between agents** — Core primitive in every multi-agent framework. Without programmatic delegation, "collaboration" is just manual handoffs via Linear tickets.
- **Completion notification** — Delegating agent must know when work finishes. Every framework handles this (callbacks, state transitions, events). Foundation exists (`wait_for` + signals); new piece is task-lifecycle-driven dispatch.
- **Shared context / knowledge** — Agents in delegation chains need shared knowledge to avoid redundant discovery. Every framework provides shared state. Biggest gap in current system.
- **Agent identity in external tools** — Linear Agent SDK solves cleanly via `actor=app`. Agents appear as workspace entities, not impersonating users. Echo filtering becomes obsolete.
- **Progress visibility** — Users need to see delegation progress. Linear Agent Plans provide checklist-style updates; Aesir dashboard shows conversation status. Gap: structured progress during delegation chains.
- **Failure handling in delegation** — Delegator must be notified of failures and able to retry/escalate/pivot. Silent failures are unacceptable. Signal infrastructure supports this; new piece is task-to-signal routing.
- **Entity/capability discovery** — Agents must know who can help. Hardcoded routing doesn't scale. Directory with semantic capability matching enables dynamic delegation.

**Should have (competitive differentiators):**
- **Negotiation handshake** — Accept/reject/counter-propose before committing. No framework implements this fully. High complexity for uncertain v1 value. Start with accept/reject; defer counter-propose.
- **Materialization as policy** — Whether delegation creates Linear ticket, Slack thread, or stays internal is prompt-level decision, not architecture. Powerful for teams with different transparency preferences.
- **Bidirectional clarification** — Target agent signals delegator for more info without completing/failing. Delegator wakes, responds, pauses again. Leverages Aesir's `wait_for` + signal strength.
- **Knowledge classification and lifecycle** — Typed entries (discovery/architecture_decision/constraint/thought) with metadata (confidence, expiry, author). Stale facts expire; contradictory facts flagged. Beyond simple key-value memory.
- **Human-agent unified directory** — Same capability query returns humans or agents. Delegation tools work identically regardless of recipient type; only materialization differs.
- **Delegation graph observability** — Task tree visualization, delegation timeline, cross-conversation tracing. Purpose-built for Aesir's task/conversation model vs. generic LLM tracing.
- **Triangular validation workflow** — QA agent closes loop: product defines, dev implements, QA validates, failures delegate back. Exercises every collaboration primitive.
- **Graceful degradation** — Collaboration enhances but isn't required. Directory down? Agents work solo. Memory unavailable? Higher token cost but functional. Each primitive is best-effort.

**Defer (v2+ or anti-patterns):**
- **Counter-propose in negotiation** — Accept/reject covers 90% of delegation scenarios. Counter-propose adds protocol complexity for edge cases. Strategy abstraction enables future addition.
- **Bidirectional clarification if Phase 74 complexity is too high** — Delegator can include sufficient context upfront. `wait_for` + signal infrastructure supports it; complexity is coordination.
- **Semantic capability matching in directory** — Start with text similarity (pg_trgm). Upgrade to vector-based when directory grows past ~20 entities.
- **Production QA agent scope** — Phase 76 QA agent is validation vehicle, not production system. Document expansion path (continuous test monitoring, regression detection) for v2.8.
- **Central orchestrator agent** — CrewAI's hierarchical manager is bottleneck with 200%+ token overhead. Peer-to-peer delegation with directory discovery aligns with agent-first philosophy.
- **Full message history on handoff** — LangGraph's default wastes context window. Task description + shared memory references enable self-service context retrieval.
- **Agent-to-agent chat channels** — Massive token waste, no clear ownership. Task-scoped communication via delegation and signals only.
- **Real-time agent presence tracking** — Infrastructure complexity for < 10 agent types. Assume always-available for v1.

### Architecture Approach

Three integration patterns: (1) new tables in `agents.*` schema (knowledge_entries, entity_directory), (2) new tool namespaces registered in existing ToolRegistry (knowledge:*, directory:*, task:delegate, task:respond), (3) new services following factory pattern (KnowledgeService, DirectoryService, MaterializationLayer, TaskSignalDispatcher). Nothing about ConversationExecutor, WorkerLoop, or EventRouter fundamentals changes.

**Major components:**
1. **KnowledgeService** — Store/query knowledge with pgvector semantic search. Dual-indexed: structured metadata (type, scope, author, expiry) + vector embedding for semantic queries. Embedding generation at store time (50-100ms latency acceptable). Private notepad uses same table with scope filter.
2. **DirectoryService** — Entity registry with semantic capability matching. Agents seeded from YAML definitions, humans from config. Capability matching via embedded combined-capabilities text, queried with cosine similarity.
3. **MaterializationLayer** — Dispatches delegated tasks based on entity type and policy. Agent target: starts conversation via executor.start(). Human target: sends Slack message or creates Linear ticket. Async best-effort, not blocking delegation.
4. **TaskSignalDispatcher** — Subscribes to task state changes (EventEmitter pattern), fires signals to callback conversations. Handles completion/failure/clarification. Orphan-aware: logs completions to terminal conversations.
5. **Linear activity denormalizer extension** — Routes to `create_agent_activity` when `replyContext.agentSessionId` present. Maps communication intents to activity types: reply→response, ask→elicitation, notify→thought.
6. **Negotiation handshake** — Implemented as signal exchange. Delegator creates task + wait_for(delegation_response). Target evaluates, calls task:respond (accept/reject). Signal wakes delegator to proceed or pivot.
7. **Completion signaling** — Task transitions to terminal state (completed/failed/cancelled) trigger signal dispatch to callback conversation. Multi-type wait_for enables delegator to handle completion, failure, clarification, and timeout signals.

**Key architectural decisions:**
- **pgvector in PostgreSQL, not separate vector DB** — Operational simplicity for moderate volume (hundreds to low thousands of entries). Transactional consistency with agent data. HNSW indexes handle scale.
- **Signal-based inter-conversation communication** — Reuses existing signal() infrastructure. Task lifecycle events drive signal dispatch. No new delivery mechanism.
- **Callback routing through tasks, not conversation IDs** — Survives conversation re-trigger. Resolve latest active conversation for parent task, not static conversation ID.
- **EventEmitter on TaskService for state changes** — In-process notification for TaskSignalDispatcher. Durable event log approach deferred until services split.
- **Orchestrator vs. sub-agent architectural boundary** — Sub-agents (coder, researcher, tester) spawn within parent conversation, share token budget. Cross-conversation delegation only for orchestrator-to-orchestrator or orchestrator-to-human. Prevents management-layer anti-pattern.

### Critical Pitfalls

Research on multi-agent LLM failures reveals 41-86.7% failure rates in production. Primary categories: specification/coordination (79% combined), not infrastructure. Top 5 critical pitfalls address the highest-severity failure modes.

1. **Completion signal lost to terminal conversation** — Delegator's conversation fails/times out before delegated work completes. Completion signal rejected because executor.signal() rejects signals to terminal conversations. Work product orphaned. Mitigation: task-level result storage (new `completion_result` JSONB column), orphan-aware signal handling (signal.orphaned event type), dashboard visibility for orphaned completions, consider reopen-on-completion pattern.

2. **Delegation depth explosion / management-layer anti-pattern** — Agents delegate instead of working. 4 conversations for 1 unit of work when sub-agent spawn would suffice. Token budget consumed by coordination overhead. Mitigation: enforce sub-agent vs. delegation boundary architecturally (sub-agents within conversation, delegation between orchestrators only), reduce MAX_TASK_DEPTH from 5 to 3 for v1, add delegationBudget per task tree, track delegation-to-work ratio in dashboard, specific prompt guidance distinguishing sub-agent spawn from cross-conversation delegation.

3. **Circular wait / deadlock** — Agent A delegates to Agent B, waits for task_completion. Agent B needs clarification, signals Agent A. But A is waiting for completion only (type mismatch). Both stuck. Mitigation: multi-type wait_for (accept array of signal types), add wait_for_task variant that registers all task-lifecycle signals automatically, enforce delegators include clarification in wait types, add deadlock detection (scheduled job scanning for circular waits).

4. **Shared memory poisoning via confident hallucination** — Agent stores stale codebase knowledge (file moved, auth changed). Later agent queries, gets wrong info, stores derived conclusion reinforcing error. Knowledge store becomes echo chamber. Research shows single compromised agent poisoned 87% of downstream decisions in 4 hours. Mitigation: mandatory expiry by category (file locations 24h, architecture decisions 7d, general patterns 30d), source_hash on knowledge entries for verification, verification_date penalizes old entries in ranking, prevent derived-knowledge loops (flag for re-verification when source expires), conservative scope for v1 (discovery and constraint only; architecture_decision requires human confirmation).

5. **Linear OAuth token migration breaks running conversations** — Migration from long-lived to short-lived tokens (24h) with refresh tokens happens April 1, 2026. Old token invalidated during migration; in-flight MCP calls fail. If refresh token rotation fails, entire Linear integration goes dark until manual re-auth. Mitigation: implement token refresh middleware BEFORE actor=app migration (prerequisite, not phase 70 feature), use migration endpoint in maintenance window after draining conversations, add 401 retry logic to callMcpTool that triggers refresh and retries once, proactively refresh at 80% lifetime (~19h), test in staging workspace first (migration irreversible).

**Additional high-severity pitfalls:**
- **Fan-out delegation with partial completion** — Delegator receives 2 completion signals and 1 failure signal; must reason about partial completion. For v1, discourage parallel delegation in prompts; sequential is simpler. Future: task_group with completion policies (all_required, any_sufficient, majority).
- **Entity directory returns stale capabilities** — Directory seeded at deploy time; changes between deploys cause stale results. Mitigation: re-seed on every deploy (CI/CD or startup), last_seeded_at timestamp with warnings, negotiation handshake validates directory claims at runtime (target rejects on capability mismatch).
- **Callback routing breaks on conversation re-trigger** — Re-trigger creates new conversation ID with `-r` suffix; callback points to original terminal conversation. Mitigation: resolve callbacks through tasks (latest active conversation for parent task), not static conversation IDs; update callbacks on re-trigger.
- **History compaction destroys delegation context** — Delegation tool calls summarized away during long waits. Agent resumes without context. Mitigation: self-contained completion signal payloads (include original task description and results), active_delegations JSONB column survives compaction, treat delegation tool calls as protected messages, inject delegation_context block on resume.
- **Agent session lifecycle mismatch** — Linear expects activity within 10 seconds; Aesir conversation is async (queued, waits for worker claim). Under load, conversation waits minutes. Mitigation: emit thought activity synchronously in webhook handler before queuing, track agentSessionId in conversation/replyContext, map conversation lifecycle to Linear session states, periodic heartbeat activities every 60s.

## Implications for Roadmap

Based on combined research, v2.7 should be structured as 7 sequential phases with one parallel execution opportunity (Phases 67+68).

### Phase 67: Linear Agent SDK

**Rationale:** Foundation for agent identity. Eliminates echo filtering permanently. Provides first-class Linear agent UX. Low-medium complexity with high-confidence API surface (official Linear docs). No dependencies on other collaboration features -- delivers value independently.

**Delivers:**
- OAuth `actor=app` re-authorization (app workspace identity)
- Token refresh middleware (addresses CRITICAL-5: April 2026 deadline)
- Agent activity MCP tools (thought/elicitation/action/response/error types)
- Session ID tracking through replyContext pipeline
- Communication-to-activity type mapping in denormalizer
- agent_session.prompted event handling replacing comment.created
- Echo filter removal (agent activities structurally distinct from user prompts)
- Agent Plans integration (checklist-style progress)

**Addresses features:**
- Table stakes: Agent identity in external tools
- Table stakes: Progress visibility (via Agent Plans)

**Avoids pitfalls:**
- CRITICAL-5: Linear OAuth token migration breaks running conversations
- HIGH-5: Agent session lifecycle mismatch with conversation lifecycle
- MODERATE-2: Echo storm during migration period

**Research needs:** Standard implementation (official Linear docs). No additional research required.

---

### Phase 68: Shared Memory (PARALLEL with Phase 67)

**Rationale:** Enables collaboration efficiency. Without shared context, delegation chains waste tokens re-discovering known facts. No dependencies on Linear SDK -- different package, different concerns. Parallel execution cuts timeline.

**Delivers:**
- agents.knowledge_entries table (classification taxonomy, vector embeddings)
- KnowledgeService with pgvector semantic search
- knowledge:store, knowledge:query, knowledge:update tools
- Private agent notepad (scope='private' filter)
- Embedding generation pipeline (Voyage AI)
- Scope and permission configuration
- Knowledge lifecycle (expiry, supersession, invalidation)

**Addresses features:**
- Table stakes: Shared context / knowledge
- Differentiator: Knowledge classification and lifecycle
- Differentiator: Graceful degradation (knowledge:query returns [] on failure)

**Avoids pitfalls:**
- CRITICAL-4: Shared memory poisoning via confident hallucination
- HIGH-6: Knowledge store becomes token sink

**Research needs:** Standard pgvector implementation. Taxonomy design requires validation during implementation (start with 4-5 types, expand based on usage).

---

### Phase 69: Entity Directory

**Rationale:** Enables dynamic delegation. Without directory, delegation targets must be hardcoded. Low complexity, high leverage. Depends on Phase 67 (agent identity must exist before directory exposes agents).

**Delivers:**
- agents.entity_directory table with capability embeddings
- DirectoryService with semantic capability matching
- directory:find, directory:get tools
- Agent seeding from YAML (extract capabilities field)
- Human entries from config
- Seed script (pnpm seed:directory)
- AgentDefinitionYamlSchema extension (capabilities field)

**Addresses features:**
- Table stakes: Entity/capability discovery
- Differentiator: Human-agent unified directory
- Differentiator: Semantic capability matching (optional -- can start with text similarity)

**Avoids pitfalls:**
- HIGH-2: Entity directory returns stale or incorrect capabilities

**Research needs:** Capability matching quality determination. Start with text similarity (pg_trgm); upgrade to semantic if quality degrades.

---

### Phase 70: Task Delegation

**Rationale:** Core collaboration primitive. Depends on Phase 69 (agents need directory to discover delegation targets). High complexity due to negotiation handshake -- most novel piece of entire milestone.

**Delivers:**
- task:delegate tool (composite: creates task + materializes + waits)
- Task table extensions (callback_conversation_id, delegation_depth, expectations)
- Negotiation handshake (accept/reject via signal exchange; defer counter-propose)
- MaterializationLayer (agent target: start conversation; human target: Slack message)
- Materialization as policy (internal vs. transparent via task metadata)
- Delegation judgment guidance in prompts
- task:respond tool (accept/reject + signal callback)
- Depth enforcement (reduce MAX_TASK_DEPTH to 3 for v1)

**Addresses features:**
- Table stakes: Task delegation between agents
- Differentiator: Negotiation handshake (accept/reject only; counter-propose deferred)
- Differentiator: Materialization as policy
- Anti-pattern avoidance: No central orchestrator, no full message history on handoff

**Avoids pitfalls:**
- CRITICAL-2: Delegation depth explosion / management-layer anti-pattern
- MODERATE-1: Negotiation handshake blocks on unresponsive agent
- MODERATE-3: Materialization layer creates integration coupling

**Research needs:** Handshake protocol validation. No proven patterns in other frameworks -- novel design requires careful testing. Consider fast-follow phase if complexity exceeds estimates.

---

### Phase 71: Completion Signaling

**Rationale:** Closes delegation loop. Depends on Phase 70 (signals need tasks to signal about). Medium-high complexity due to orphan handling, circular wait prevention, and multi-type wait_for.

**Delivers:**
- TaskSignalDispatcher (EventEmitter on TaskService, subscribes to state changes)
- Callback conversation signal dispatch (completion/failure/clarification/timeout)
- Multi-type wait_for (accept array of signal types)
- wait_for_task variant (auto-registers all task-lifecycle signals)
- Orphan-aware signal handling (signal.orphaned event, task completion_result JSONB)
- Callback routing through tasks (not static conversation IDs)
- Delegation context preservation (active_delegations JSONB, self-contained signal payloads)
- Expectation-based timeout (pg-boss delayed signal from handshake estimate)
- Deadlock detection (optional: scheduled job scanning circular waits)

**Addresses features:**
- Table stakes: Completion notification
- Table stakes: Failure handling in delegation
- Differentiator: Bidirectional clarification (if complexity allows; otherwise defer)

**Avoids pitfalls:**
- CRITICAL-1: Completion signal lost to terminal conversation
- CRITICAL-3: Circular wait / deadlock between delegating agents
- HIGH-3: Callback routing breaks on conversation re-trigger
- HIGH-4: History compaction destroys delegation context
- HIGH-1: Fan-out delegation with partial completion (sequential-only for v1)

**Research needs:** Signal routing strategy validation. Multi-type wait_for is extension of proven infrastructure; risk is coordination complexity for bidirectional clarification. Consider deferring bidirectional clarification if phase becomes too large.

---

### Phase 72: Delegation Graph Observability

**Rationale:** Full lifecycle must exist before visualization. Depends on Phase 71 (completion signaling completes the observable lifecycle). Medium complexity -- mostly dashboard work over existing data.

**Delivers:**
- Task tree API endpoints (GET /api/tasks/:taskId/tree, /timeline, /signals)
- Dashboard task tree view (React components with lazy expansion)
- Delegation timeline (chronological event list)
- Cross-conversation trace view (click-through from task to conversation)
- Signal flow visualization (edges between conversations, timeline with payloads)
- Health indicators (orphans, timeouts, rejection chains, excessive depth)
- Dashboard schema mirroring (new tables in dashboard lib/schema.ts)

**Addresses features:**
- Differentiator: Delegation graph observability

**Avoids pitfalls:**
- MODERATE-4: Database hot path from cross-conversation queries
- MINOR-2: Dashboard performance degradation from delegation graph rendering

**Research needs:** Standard dashboard implementation. React Flow and dagre are industry standard. UX design for comprehensible delegation graphs (not just technically correct trees).

---

### Phase 73: QA Agent + Validation Workflow

**Rationale:** Exercises entire collaboration system. Depends on Phase 72 (all infrastructure must exist). High complexity due to multi-step feedback loop and integration test requirements.

**Delivers:**
- QA agent definition (YAML + prompt.md)
- Core QA tools (run tests via sandbox, check PR via GitHub, review requirements)
- Collaboration wiring (uses directory, delegation, knowledge, communication tools)
- Feedback loop (QA fail → delegate fix to dev → dev fixes → dev delegates re-verification to QA → QA passes → completion chain unwinds)
- End-to-end validation test suite (integration tests for triangular workflow)

**Addresses features:**
- Differentiator: Triangular validation workflow
- Integration test: All collaboration primitives exercised simultaneously

**Avoids pitfalls:**
- All above pitfalls compound in triangular workflow -- Phase 73 surfaces any remaining issues from Phases 67-72

**Research needs:** QA agent is validation vehicle. Test infrastructure for multi-agent scenarios requires careful design. This phase should only begin when all preceding phases are validated in isolation.

---

### Phase Ordering Rationale

**Parallel execution (67+68):** Linear Agent SDK and Shared Memory have no dependencies on each other. Different packages (integration-linear vs agents), different concerns (identity vs knowledge). Parallel execution reduces total timeline by ~7-10 days.

**Sequential after 68:** Entity Directory (Phase 69) depends on agent identity being resolved (Phase 67). Agents with `actor=app` have real Linear identities that should be reflected in the directory. Building directory before identity is resolved risks misalignment.

**Delegation after directory:** Task Delegation (Phase 70) requires knowing WHO to delegate to. Without directory, delegation is blind (hardcoded agent IDs in prompts). Directory enables informed, dynamic delegation decisions.

**Signaling after delegation:** Completion Signaling (Phase 71) only makes sense after delegation exists. The callback routing mechanism depends on task structure created in Phase 70. Building signaling first would require constant rework as delegation structure evolves.

**Observability after signaling:** Delegation Graph Observability (Phase 72) visualizes what exists. Building it before the full lifecycle (delegation + handshake + completion) is complete would show incomplete workflows. Dashboard queries depend on callback routing and signal delivery patterns established in Phase 71.

**QA agent last:** Phase 73 exercises everything simultaneously: directory queries, delegation handshakes, materialization, completion signaling, clarification signals, shared memory, and delegation depth. Building it before infrastructure is complete would cause constant rework. It is the integration test for the entire milestone.

**How this avoids pitfalls:** Sequential phases with explicit dependencies prevent coupling issues. Phase 70 (delegation) enforces sub-agent vs. delegation boundary before any agents use it. Phase 71 (signaling) implements orphan handling and deadlock detection before Phase 73's complex feedback loops stress-test them. Each phase must be validated before the next begins -- no phase-jumping.

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 67 (Linear Agent SDK):** Official Linear developer docs provide complete API surface. Token refresh is standard OAuth pattern. Activity type mapping is straightforward.
- **Phase 68 (Shared Memory):** pgvector + Drizzle ORM integration well-documented. Embedding generation via Voyage AI SDK is standard. Schema design follows established patterns.
- **Phase 69 (Entity Directory):** Simple CRUD service with semantic search. Seeding from YAML matches existing seed:permissions pattern.
- **Phase 72 (Delegation Graph Observability):** Standard dashboard implementation over existing data. React Flow + dagre patterns well-documented.

**Phases likely needing deeper research during planning:**
- **Phase 70 (Task Delegation):** Negotiation handshake is novel -- no proven patterns in other frameworks. Strategy abstraction interface needs validation. Materialization layer dispatch logic needs careful design to avoid integration coupling. Recommend research-phase for handshake protocol design.
- **Phase 71 (Completion Signaling):** Multi-type wait_for is extension of proven infrastructure, but coordination complexity for bidirectional clarification is uncertain. Orphan handling and deadlock detection need specific implementation strategies. Recommend research-phase for signal coordination patterns.
- **Phase 73 (QA Agent):** Feedback loop choreography (3-level delegation depth with bidirectional signaling) is complex. Test infrastructure for multi-agent scenarios needs design. Recommend research-phase for workflow orchestration and test patterns.

**Phased validation approach:** Do not start Phase 70 until Phase 69 validated in production. Do not start Phase 71 until Phase 70's handshake proven. Do not start Phase 73 until Phases 67-72 stress-tested individually. Each phase's failure modes compound with previous phases -- sequential validation is critical.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | pgvector + Drizzle ORM extensively documented. Voyage AI official Anthropic recommendation. React Flow industry standard. Only medium area: Linear Agent SDK (developer preview) -- mitigated with feature flags. |
| Features | HIGH | Competitor analysis across CrewAI, LangGraph, AutoGen, A2A protocol, Linear Agent SDK provides clear table stakes vs. differentiators. Negotiation handshake novelty is risk, but strategy abstraction enables iteration. |
| Architecture | HIGH | All patterns (factory services, signal-based communication, denormalizer extension, seed scripts) proven in existing codebase. pgvector in PostgreSQL avoids separate vector DB operational complexity. Task tree structure already exists (parent_id, recursive CTEs). |
| Pitfalls | HIGH | Multi-agent failure research (41-86.7% production failure rates) provides clear priorities. Critical pitfalls (signal loss, delegation depth, circular wait, memory poisoning, token migration) all have specific, testable mitigations. |

**Overall confidence:** HIGH

Research sources are primarily official documentation (Linear, Drizzle ORM, React Flow, pgvector), established open-source frameworks (CrewAI, LangGraph, AutoGen), and peer-reviewed research papers (multi-agent failure modes, memory poisoning). Secondary sources (vendor blogs, industry analysis) used only to corroborate findings from primary sources.

### Gaps to Address

**Embedding provider choice:** Voyage AI is Anthropic's recommendation, but no official Anthropic embeddings API yet. OpenAI text-embedding-3-small is fallback (1536 dims vs 1024 dims -- requires schema change). Design KnowledgeService with provider abstraction to enable swapping. Test both providers in Phase 68 planning.

**Negotiation handshake complexity:** No proven patterns in other frameworks. Strategy abstraction interface is sound, but actual accept/reject/counter-propose choreography needs validation. Consider starting with accept/reject only (counter-propose deferred) if Phase 70 estimates exceed budget. The spec already designs for this via strategy abstraction.

**Bidirectional clarification signaling:** High value but high complexity. If Phase 71 becomes too large, defer bidirectional clarification to fast-follow phase. Delegators can include sufficient context upfront (task description + knowledge references) to reduce need for mid-task clarification. The `wait_for` + signal infrastructure supports it -- complexity is coordination, not infrastructure.

**Knowledge classification taxonomy:** Start with 4-5 types (discovery, architecture_decision, constraint, preference, fact). Validate with real agent usage before expanding. Over-classification leads to miscategorization and retrieval failures. Log unclassified entries to inform taxonomy evolution.

**Token budget across delegation trees:** Phase 71 accepts independent token budgets per conversation (cross-conversation delegation). Future milestone should add tree_token_budget for budget enforcement across entire delegation tree. At minimum, Phase 72 tracks total token usage per task tree for operator visibility.

**Linear API stability:** Agent SDK is developer preview. Changes may require adaptation. All Linear Agent SDK code should be behind feature flag (LINEAR_AGENT_SDK_ENABLED=true) so system can fall back to comment-based communication if SDK breaks. Test fallback path explicitly in Phase 67.

**Task state change notification mechanism:** Phase 71 uses EventEmitter on TaskService (in-process). If services split to multiple processes later, switch to event log append with subscribers (durable). Document migration path but don't over-engineer for v1 where everything is single-process agent-service.

**Semantic vs. text-based capability matching:** Phase 69 can start with text similarity (pg_trgm) for directory:find. Upgrade to semantic matching (pgvector embeddings on capabilities) when directory grows past ~20 entities or matching quality degrades. With 5-6 initial agents, text matching sufficient. Validate matching quality during Phase 69 planning.

## Sources

### Primary (HIGH confidence)

**Linear Agent SDK:**
- Linear Developers -- Getting Started with Agents (https://linear.app/developers/agents)
- Linear Developers -- Agent Interaction (https://linear.app/developers/agent-interaction)
- Linear Developers -- OAuth Actor Authorization (https://linear.app/developers/oauth-actor-authorization)
- Linear Developers -- OAuth 2.0 Authentication (https://linear.app/developers/oauth-2-0-authentication)
- Linear Changelog -- Agent Interaction Guidelines and SDK (https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk)
- @linear/sdk npm package (https://www.npmjs.com/package/@linear/sdk) -- Version 75.0.0

**pgvector + Drizzle ORM:**
- Drizzle ORM -- Vector Similarity Search Guide (https://orm.drizzle.team/docs/guides/vector-similarity-search)
- Drizzle ORM -- PostgreSQL Extensions (https://orm.drizzle.team/docs/extensions/pg)
- pgvector-node GitHub (https://github.com/pgvector/pgvector-node)
- pgvector Docker Hub (https://hub.docker.com/r/pgvector/pgvector)

**Embedding Generation:**
- Anthropic Embeddings Guide (https://platform.claude.com/docs/en/build-with-claude/embeddings)
- Voyage AI TypeScript SDK (https://github.com/voyage-ai/typescript-sdk)
- Voyage AI Pricing (https://docs.voyageai.com/docs/pricing)

**Dashboard Visualization:**
- React Flow -- Quick Start (https://reactflow.dev/learn)
- React Flow -- Dagre Tree Example (https://reactflow.dev/examples/layout/dagre)
- React Flow -- React 19 + Tailwind 4 announcement (https://reactflow.dev/whats-new/2025-10-28)
- @dagrejs/dagre npm (https://www.npmjs.com/package/@dagrejs/dagre)

**Multi-Agent Frameworks:**
- CrewAI Documentation -- Collaboration (https://docs.crewai.com/en/concepts/collaboration)
- CrewAI GitHub -- Hierarchical Delegation PR #2068 (https://github.com/crewAIInc/crewAI/pull/2068)
- LangGraph Multi-Agent Documentation (https://docs.langchain.com/oss/python/langchain/multi-agent)
- LangGraph Supervisor Repository (https://github.com/langchain-ai/langgraph-supervisor-py)
- AutoGen -- Microsoft Research (https://www.microsoft.com/en-us/research/project/autogen/)
- A2A Protocol -- Google Developers Blog (https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

**Multi-Agent Failure Research:**
- Why Do Multi-Agent LLM Systems Fail? (https://arxiv.org/html/2503.13657v1) -- 14 failure modes, 41-86.7% failure rates
- Memory Poisoning Attack and Defense (https://arxiv.org/html/2601.05504)

**Existing Codebase:**
- packages/agents/src/framework/ -- ConversationExecutor, ToolRegistry, EventLog, HistoryManager
- packages/agents/src/shared/ -- Agent loop, tool factories, task service
- packages/integrations/linear/src/ -- MCP tools, OAuth, webhooks, denormalizer
- packages/dashboard/src/ -- Next.js 15, local schema, SSE proxy

### Secondary (MEDIUM confidence)

**Shared Memory / Knowledge:**
- Letta Memory Documentation (https://docs.letta.com/guides/agents/memory/)
- MemGPT Concepts (https://docs.letta.com/concepts/memgpt/)
- Agent Memory: How to Build Agents that Learn and Remember -- Letta Blog (https://www.letta.com/blog/agent-memory)
- Cairn MCP (https://github.com/jasondostal/cairn-mcp) -- Semantic memory for AI agents

**Observability:**
- Agent Tracing for Multi-Agent AI Systems -- Maxim AI (https://www.getmaxim.ai/articles/agent-tracing-for-debugging-multi-agent-ai-systems/)
- Agent Observability and Tracing -- Arize (https://arize.com/ai-agents/agent-observability/)
- OpenTelemetry -- AI Agent Observability (https://opentelemetry.io/blog/2025/ai-agent-observability/)

**Multi-Agent Patterns:**
- Multi-Agent Frameworks Explained for Enterprise AI Systems 2026 (https://www.adopt.ai/blog/multi-agent-frameworks)
- Multi-Agent Coordination Strategies -- Galileo AI (https://galileo.ai/blog/multi-agent-coordination-strategies)
- Multi-Agent AI Orchestration: Enterprise Strategy 2025-2026 (https://www.onabout.ai/p/mastering-multi-agent-orchestration-architectures-patterns-roi-benchmarks-for-2025-2026)

**Anti-Patterns:**
- Why Your Multi-Agent System is Failing: 17x Error Trap of Bag of Agents (https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- Why Multi-Agent LLM Systems Fail and How to Fix Them -- Augment Code (https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them)
- Cascading Failures in Agentic AI -- OWASP ASI08 (https://adversa.ai/blog/cascading-failures-in-agentic-ai-complete-owasp-asi08-security-guide-2026/)
- AI Agent Memory Poisoning -- MintMCP (https://www.mintmcp.com/blog/ai-agent-memory-poisoning)

### Tertiary (LOW confidence)

**Agent Discovery:**
- Agent Communication & Discovery Protocol (https://www.cmdzero.io/blog-posts/introducing-the-agent-communication-discovery-protocol-acdp-a-proposal-for-ai-agents-to-discover-and-collaborate-with-each-other) -- Proposal, not adopted standard
- Microsoft Multi-Agent Reference Architecture (https://microsoft.github.io/multi-agent-reference-architecture/docs/reference-architecture/Reference-Architecture.html) -- Reference, not production patterns

**Comparative Analysis:**
- Best Embedding Models 2026 (https://elephas.app/blog/best-embedding-models) -- Benchmark data for embedding provider choice
- Choosing the Right Orchestration Pattern for Multi-Agent Systems -- Kore.ai (https://www.kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems) -- Vendor content

---
*Research completed: 2026-02-10*
*Ready for roadmap: yes*
