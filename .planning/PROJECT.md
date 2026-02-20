# Aesir

## What This Is

An agentic development platform that automates software development workflows -- from feature request to shipped code. A Postgres-backed conversation executor with declarative agent definitions. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage. Tasks provide multi-conversation continuity through structured handoffs, enabling agents to maintain context across interactions. The platform is resilient: failures notify all channels, MCP errors are classified for agent decision-making, crashed conversations resume with recovery context, and echo loops are eliminated at the infrastructure level. Includes a real-time operations dashboard with 18 event types, tool call grouping, sub-agent attribution, cost estimation, and work correlation tracking.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Current Milestone: v2.9 Platform Completion

**Goal:** Complete every collaboration capability agents will need before domain modeling begins — richer negotiation, parallel delegation, transparent materialization, tree-level budgets, scheduled execution, sub-agent discovery, persistent identity, and knowledge retrieval enhancement.

**Target features:**
- Richer negotiation: counter-proposals and mid-task clarification in delegation handshake
- Parallel delegation: fan-out with completion policies (all_required, any_sufficient, majority)
- Transparent materialization: optional Linear ticket creation for delegated tasks
- Tree-level token budgets: budget enforcement across entire delegation trees
- Scheduled agent execution: cron-based triggers via pg-boss for periodic work
- Sub-agent discovery: capability-based selection replacing hardcoded YAML references
- Persistent agent identity: structured, versioned identity documents per agent role
- Knowledge retrieval enhancement: pluggable pipeline + pre-compaction knowledge flush

## Current State

**Version:** v2.8 Resilience and Observability (shipped 2026-02-18)

**Tech Stack:**
- TypeScript/Node.js monorepo (pnpm workspaces)
- ~118,000 lines across 8 packages
- @anthropic-ai/sdk for agentic tool-use loops
- Postgres-backed ConversationExecutor with SKIP LOCKED claiming (no Temporal)
- Declarative agent definitions (YAML + prompt.md) with AgentRegistry + ToolRegistry
- Unified event log (agent_events) with SessionProjection
- Task primitive with structured handoffs and cross-conversation delegation for multi-agent collaboration
- Shared memory (pgvector knowledge store with semantic search, classification, expiry)
- Entity directory (agents discoverable by capability via embedding similarity)
- PostgreSQL + pgvector for all persistence (conversations, events, sessions, tasks, knowledge, directory, credentials)
- Docker Compose for local development (7 services: PostgreSQL/pgvector, nginx, 3 integrations, agent-service, dashboard)
- MCP (Model Context Protocol) for agent-integration communication with task correlation
- Smart router with hybrid event classification (deterministic + task-aware + LLM)
- Next.js 15 operations dashboard with Tailwind, shadcn/ui, Drizzle ORM, SSE real-time updates

**Architecture:**
```
Dashboard (port 3005, Next.js 15)
   ↓ reads Postgres directly + HTTP to agent-service /api/*
   ↓ SSE proxy to agent-service /api/sse/events
Agent Service (port 3004)
   ↓ routes events via EventRouter (task-aware + fast-path + LLM)
ConversationExecutor (SKIP LOCKED worker loop)
   ↓ runs declarative agents with task context injection
Agent definitions (YAML + prompt.md, constitutional + few-shot style)
   ↓ tools via MCP (X-Task-ID correlation)
@aesir/integration-{linear,github,slack} (independent services)
   ↓ imports
@aesir/platform, @aesir/types (shared infrastructure)
```

**Key Capabilities:**
- Agentic tool-use loops: agents reason about what to do via @anthropic-ai/sdk native tool-use
- Dev agent orchestrator with sub-agents (researcher, coder, tester) via spawn_agent tool
- Product agent adapts conversation strategy based on input clarity
- 45+ tool factories in namespace:tool_name registry with ToolContext injection (including 6 task tools, 3 communication tools, 3 knowledge tools, 2 directory tools, 2 delegation tools)
- Task primitive: multi-conversation continuity with structured handoffs, cross-conversation delegation, hierarchy guardrails (depth 5, subtask 10, circular delegation prevention)
- Task delegation: agents delegate to other agents via directory discovery, negotiation handshake (accept/reject), completion signaling cascade
- Shared memory: knowledge:store/query/update with 6 classification types, pgvector semantic search, mandatory expiry, deduplication
- Entity directory: agents discover each other by capability via semantic embedding matching, seeded from YAML definitions
- Bidirectional task correlation across all integrations (X-Task-ID header, task_correlations tables)
- Task-aware event routing with advisory lock serialization and automatic context enrichment
- Conversation reopening: completed/failed conversations resume on follow-up events with world-state injection
- Hybrid event routing: task-based → deterministic fast-path → LLM slow-path
- Unified event log with session projection for ground-truth artifact tracking
- Three-phase history compaction (tool pruning → LLM summarization → artifact grounding)
- wait_for tool for agent-controlled pause/resume with signal queueing
- pg-boss timeout scheduling for delayed signal delivery
- Goal-oriented agent prompts: constitutional constraints + few-shot reasoning examples (no procedural state machines)
- Guardrails: sandbox enforcement, merge protection, token budgets, spawn depth limits, task hierarchy limits
- Graceful shutdown with conversation draining
- Real-time operations dashboard: conversations, agents, tools, task delegation graphs, system overview with SSE live updates
- Dashboard features: dark mode, sidebar navigation, permission matrix, inline LLM content, URL-persisted state, reopen/retry actions, React Flow delegation graph with health indicators
- Domain-language communication: agents use reply/ask/notify instead of channel-specific tools, infrastructure denormalizes to Slack/Linear/GitHub
- ReplyContext propagation: inbound adapters extract channel context, signals carry it, agents receive opaque context to pass through
- Echo loop prevention: agent-authored comments filtered at adapter level before re-entering inbound pipeline
- Webhook dedup: event ID dedup table with 24h TTL cleanup rejects duplicate deliveries at adapter level
- MCP error classification: permanent (4xx) vs transient (429/5xx) with structured context and transparent retry
- Failure notifications: channel-agnostic notification at all 5 terminal failure paths with notification.failed backstop
- Recovery context: crashed conversations resume with XML block describing work since last persistence point
- Graceful shutdown: worker drain on SIGTERM with abort signaling and health 503 during draining
- Work correlation: entity tracking (work_correlations table), router correlation fallback, disposition vocabulary
- Dashboard timeline: 18 event types with distinct icons/colors, tool call cards, sub-agent pills, lifecycle banners, filter chips, metrics bar with cost estimate

## Requirements

### Validated

**v1 MVP (shipped 2026-01-19):**
- ✓ Product Agent: gathers requirements through conversation, creates structured Linear tasks — v1.0
- ✓ Dev Agent: picks tasks, writes code and tests, updates Linear status, opens GitHub PRs — v1.0
- ✓ Review loop: agents respond to PR feedback (from humans or other agents) — v1.0
- ✓ Linear integration: read/update tasks via webhooks, agent appears as app identity — v1.0
- ✓ GitHub integration: branches, commits, PRs, read comments, merge on approval — v1.0
- ✓ Slack integration: notifications when human approval needed, status updates — v1.0
- ✓ Human-in-the-loop support: conversations pause for approval/review — v1.0
- ✓ Agent configuration: define agents via code/config files — v1.0
- ✓ Logging/observability: all actions logged with timestamp, context, task ID — v1.0
- ✓ Webhook-driven events: agents wake on Linear/GitHub events via Cloudflare tunnel — v1.0

**v2.0 Foundation (shipped 2026-01-25):**
- ✓ 3-layer architecture: Platform → Integrations → Agents with clear boundaries — v2.0
- ✓ MCP-based agent-integration communication (19 tools across Linear, GitHub, Slack) — v2.0
- ✓ Independent integration packages with own databases and Dockerfiles — v2.0
- ✓ pnpm monorepo with TypeScript project references — v2.0
- ✓ pino logging with correlation IDs — v2.0
- ✓ PostgreSQL-backed credential storage with encryption — v2.0
- ✓ Testing infrastructure (testcontainers, MSW, factories) — v2.0
- ✓ One-command local dev via Docker Compose — v2.0
- ✓ Graceful shutdown and health checks — v2.0

**v2.1 Agents That Ship (shipped 2026-01-28):**
- ✓ Event infrastructure: webhook routing, normalized events, integration dispatchers — v2.1
- ✓ Dev container: persistent Docker containers with Node.js, pnpm, git, gh CLI — v2.1
- ✓ Product-agent: Slack conversation → clarifying questions → well-structured Linear issue — v2.1
- ✓ Dev-agent: Linear issue → codebase research → execution plan → code → tests → PR — v2.1
- ✓ Human-in-the-loop: dual-channel approvals (Linear + Slack), cross-channel sync — v2.1
- ✓ Feedback loops: plan revision on rejection, PR review → additional commits — v2.1
- ✓ Task completion: PR merge → Linear status → Slack notification → container cleanup — v2.1

**v2.2 Agentic Architecture (shipped 2026-01-31):**
- ✓ Agentic tool-use loop runtime with @anthropic-ai/sdk native tool-use (78/78 requirements) — v2.2
- ✓ Agent tool library: 25 tools in 4 role-specific toolkits — v2.2
- ✓ Dev agent orchestrator with sub-agents replacing 13-node LangGraph graph — v2.2
- ✓ Product agent as single adaptive agentic loop replacing 6-node LangGraph graph — v2.2
- ✓ Smart router: hybrid deterministic + LLM event classification — v2.2
- ✓ Execution tracing with parent/child agent correlation — v2.2
- ✓ Guardrails: iteration limits, cost budgets, escalation with diagnosis — v2.2
- ✓ All @langchain/* dependencies removed — v2.2

**v2.3 Unified Agent Framework (shipped 2026-02-04):**
- ✓ Declarative agent definitions (YAML + prompt.md) with AgentRegistry — v2.3
- ✓ Unified event log replacing execution_traces, tasks, context_snapshots — v2.3
- ✓ ConversationExecutor with pause/resume/signal routing (replaces Temporal) — v2.3
- ✓ Three-phase history management (tool pruning → anchored summary → artifact grounding) — v2.3
- ✓ Agent registry + tool registry with namespace-based resolution — v2.3
- ✓ Single agent service replacing per-agent HTTP servers — v2.3
- ✓ Generalized signal handling with adapters and signal queueing — v2.3
- ✓ wait_for tool for agent-controlled pause/resume — v2.3
- ✓ Smart router adapted from Temporal to ConversationExecutor — v2.3
- ✓ Temporal dependency, per-agent services, old persistence stores removed — v2.3
- ✓ Sub-agent spawn via nested in-process agent loops with shared token budgets — v2.3

**v2.4 Operations Dashboard (shipped 2026-02-05):**
- ✓ Dashboard infrastructure: Next.js 15 App Router with Tailwind, shadcn/ui, Drizzle, Docker/Nginx (52/52 requirements) — v2.4
- ✓ Conversations view: filterable list with token aggregation, event timeline with inline LLM content — v2.4
- ✓ Agent definitions view: list and detail sourced from agent-service runtime registry — v2.4
- ✓ Tool dashboard: registry, permission matrix with mismatch detection, performance metrics, failures, integration health — v2.4
- ✓ System overview: conversation summary, active conversations, worker status, token usage — v2.4
- ✓ Real-time updates: SSE endpoint on agent-service, EventStreamStore, useEventStream hook, live updates across all views — v2.4
- ✓ Agent service API extensions: /api/tools/registry, /api/agents/registry, /api/worker/status, /api/sse/events — v2.4

**v2.5 Agentic Conversations (shipped 2026-02-08):**
- ✓ Goal-oriented prompt rewrites: product-agent and dev-agent rewritten from procedural state machines to constitutional constraints + few-shot reasoning (68/68 requirements) — v2.5
- ✓ Conversation reopening: completed/failed conversations receive `reopen` signals, world-state injection, dashboard UI — v2.5
- ✓ Task primitive: tasks/task_handoffs tables, TaskService, task_id on conversations, automatic context injection — v2.5
- ✓ Agent task tools: 6 tools (create_task, complete_task, pause_task, handoff_task, list_tasks, get_task_context) with hierarchy guardrails — v2.5
- ✓ Integration correlation: bidirectional task correlation across Linear, GitHub, Slack via X-Task-ID header — v2.5
- ✓ Task-aware event routing: task-based routing priority with advisory lock serialization, backward compatible — v2.5
- ✓ Prompt evolution: all agent prompts leverage task lifecycle, handoff examples, graceful degradation — v2.5

**v2.6 Unified Agent Communication (shipped 2026-02-09):**
- ✓ ReplyContext discriminated union (Slack/Linear/GitHub variants) with inbound adapter extraction — v2.6
- ✓ Signal pipeline propagation: replyContext in schemas, XML tags in agent messages — v2.6
- ✓ Outbound denormalizer: channel-based dispatch to Slack/Linear/GitHub MCP tools — v2.6
- ✓ Communication tools: reply, ask, notify with Zod validation and denormalizer delegation — v2.6
- ✓ MCP tools: linear:create_comment exposed, github:create_pr_comment implemented — v2.6
- ✓ Agent migration: dev-agent and product-agent on domain-language communication — v2.6
- ✓ Router updates: channel-agnostic follow-up routing, replyContext auto-injection — v2.6
- ✓ Echo loop prevention: Linear comment webhook filter — v2.6
- ✓ Test coverage: 69 communication pipeline tests (42/45 requirements satisfied, 1 dropped, 2 moved) — v2.6

**v2.7 Agent Collaboration (shipped 2026-02-13):**
- ✓ Linear Agent SDK: actor=app OAuth, typed activities (thought/elicitation/action/response/error), proactive token refresh, echo elimination by design — v2.7
- ✓ Shared Memory: pgvector knowledge store with 6 classification types, semantic search, mandatory expiry, deduplication — v2.7
- ✓ Entity Directory: agents discover each other by capability via semantic embedding matching, idempotent YAML seeding — v2.7
- ✓ Task Delegation: cross-conversation delegation with accept/reject handshake, depth enforcement (max 5), focused briefs — v2.7
- ✓ Completion Signaling: TaskSignalDispatcher, multi-type wait_for, wait_for_task, orphan handling, active_delegations context — v2.7
- ✓ Delegation Graph Observability: React Flow task tree, dagre layout, health badges, delegation timeline, conversation cross-links — v2.7
- ✓ QA Agent: delegation-only agent validating triangular product→dev→QA workflow (48/49 requirements, LSDK-08 deferred) — v2.7

**v2.8 Resilience and Observability (shipped 2026-02-18):**
- ✓ Quick Fixes: get_task_context graceful null, dev-agent ask+wait_for, spawn_agent dynamic validation, test agent notify removal — v2.8
- ✓ Echo Elimination: webhook dedup via event ID table, actor-based echo suppression (Linear/GitHub/Slack), suppressed event logging — v2.8
- ✓ MCP Error Classification: permanent/transient HTTP classification, structured agent context, transparent retry with backoff, 4 observability event types — v2.8
- ✓ Failure Notifications: channel-agnostic notification at all 5 terminal failure paths, notification.failed backstop for dashboard visibility — v2.8
- ✓ Recovery Context: crash resume with `<recovery_context>` XML block, last_persisted_sequence tracking at 6 persistence boundaries — v2.8
- ✓ Graceful Shutdown: worker drain on SIGTERM, abort signaling, health 503, re-enqueue of aborted conversations — v2.8
- ✓ Dashboard Observability: 18 event types with distinct icons/colors, tool call cards, sub-agent attribution, lifecycle banners, filter chips, metrics bar with cost estimate — v2.8
- ✓ Work Correlation: entity correlation registry, work:register/query tools, auto-registration at executor.start(), correlation fallback routing, disposition vocabulary, knowledge exact match mode — v2.8

### Active

**v2.9 Platform Completion (in progress):**
- [ ] Richer negotiation: counter-proposals and mid-task clarification in delegation handshake
- [ ] Parallel delegation: fan-out with completion policies (all_required, any_sufficient, majority)
- [ ] Transparent materialization: optional Linear ticket creation for delegated tasks
- [ ] Tree-level token budgets: budget enforcement across entire delegation trees
- [ ] Scheduled agent execution: cron-based triggers via pg-boss for periodic work
- [ ] Sub-agent discovery: capability-based selection replacing hardcoded YAML references
- [ ] Persistent agent identity: structured, versioned identity documents per agent role
- [ ] Knowledge retrieval enhancement: pluggable pipeline + pre-compaction knowledge flush

**Candidates for future milestones:**
- [ ] Stale task cleanup: timeout signal mechanism for inactive tasks (TASK-26, deferred from v2.5)
- [ ] Prompt evaluation tooling (promptfoo, shadow mode)
- [ ] CI/CD pipeline for deployment
- [ ] Monitoring and alerting for agent health
- [ ] Multi-environment configuration (dev/staging/prod)
- [ ] Cross-session learning (agents improve from past task outcomes)
- [ ] LISTEN/NOTIFY for event-driven worker wakeup (replace polling)
- [ ] Dashboard authentication enforcement (Auth.js, multi-tenancy)
- [ ] Dashboard editing capabilities (agent definitions, permissions, conversation actions)
- [ ] Historical analytics and trend analysis
- [ ] Automated E2E tests (Playwright)
- [ ] Full bidirectional task assignment (agent → human task delivery via integrations)
- [ ] Handoff quality evaluation (LLM-as-judge)
- [ ] Correlation miss rate monitoring
- [ ] Agent → human task notification delivery (Slack DM, Linear assignment)
- [ ] LSDK-08: Agent Plans checklist-style progress in Linear UI (deferred from v2.7)
- [ ] Markdown-to-Slack-mrkdwn format translation (FMT-01, deferred from v2.6)
- [ ] Linear OAuth token migration (deadline: April 1, 2026)

### Out of Scope

- Full codebase indexing / RAG — agents explore via read_file/search_codebase tools; pgvector used for knowledge + directory only
- UI for agent creation — code/config first, UI is future enhancement
- Streaming LLM responses — non-streaming appropriate for backend agents
- Multi-repo support — agents work on single configured repo; future enhancement
- Full event sourcing library — append-only store with ~200 lines is sufficient
- Central orchestrator agent — bottleneck with 200%+ token overhead; peer-to-peer delegation with directory discovery instead
- Agent-to-agent chat channels — massive token waste, no clear ownership; task-scoped communication only
- Separate vector database — pgvector in PostgreSQL sufficient for knowledge + directory volume

## Context

**Team Background:**
- TypeScript/Node experience with AWS deployment target
- No hard constraints on external integrations

**Philosophy:**
- Agents should feel like coworkers using the same tools humans use
- Minimize context-switching — humans interact via Linear, GitHub, Slack
- Right tool for the right job — open to different technologies
- Prefer well-maintained external libraries over hand-rolling
- Agent-first problem solving: fix agent behavior via prompts and tools, not deterministic overrides

**Known Tech Debt (updated after v2.8):**
- Dispatcher route fallback defaults reference router:3006 instead of agent-service:3004 (22 occurrences; runtime correct via docker-compose)
- Two signal types (user_reply, cancel) defined in SIGNAL_AGENT_MAP but no adapter produces them (reserved for future)
- schema.drizzle.ts retains legacy table definitions (intentional, prevents destructive drizzle-kit migrations)
- 4 pre-existing test failures, 11 tests skipped pending infrastructure
- Run dev-agent container as non-root (infrastructure improvement)
- Self-referential FK (tasks.parent_id) handled by SQL migration only, not Drizzle references() — avoids TypeScript circular reference issue
- LSDK-08 deferred: Agent Plans checklist-style progress in Linear UI
- Linear OAuth token migration deadline: April 1, 2026 (LSDK-02 token refresh shipped, must be tested before deadline)
- Human directory entries: schema ready but seeding + delegation deferred
- Counter-propose in handshake: accept/reject only; strategy interface ready for future
- Parallel delegation: sequential only; task groups with completion policies deferred
- Markdown-to-Slack-mrkdwn format translation not yet implemented (FMT-01, deferred from v2.6)
- Linear Agent SDK is developer preview — feature flag (LINEAR_AGENT_SDK_ENABLED) may be needed for fallback
- event.routed sequence=0 collision: second event.routed per conversation silently dropped by unique constraint (observability only, routing unaffected)
- work:register and work:query tools registered in ToolRegistry but absent from production agent definition YAML files (auto-registration at executor.start() works)
- 12 human verification items pending across Phases 77-79 (visual/interactive/live-stack testing)

## Constraints

- **Multi-LLM**: Must support multiple providers (Claude, GPT-4, etc.)
- **Tool Integration**: Must work with Linear, GitHub, Slack — non-negotiable
- **Coworker UX**: Agents appear in existing tools, not a separate system
- **Full Containerization**: All services run in Docker containers
- **Tunnel-First External Access**: External services reach us via Cloudflare tunnels
- **Service Independence**: Each integration can be deployed/scaled independently
- **Agent-First Architecture**: Agent behavior controlled via prompts/tools, not deterministic wrapper code

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Postgres-backed ConversationExecutor | SKIP LOCKED claiming, conversation semantics don't map to generic job queues | ✓ Good — replaced Temporal (v2.3) |
| Declarative YAML + prompt.md agents | Adding new agent = new directory, zero code changes | ✓ Good — 5 agents defined declaratively (v2.3) |
| Unified event log (agent_events) | Single source of truth replacing 3 disconnected stores | ✓ Good — simpler, more reliable (v2.3) |
| pg-boss for timeout scheduling only | Delayed signal delivery is a pure delayed-job problem | ✓ Good — clean separation (v2.3) |
| Domain-language signal types | approval, pr_review, pr_merged, pr_closed vs Temporal signal names | ✓ Good — clearer semantics (v2.3) |
| Three-phase history compaction | Tool pruning → LLM summary → artifact grounding with fallback | ✓ Good — prevents context overflow (v2.3) |
| Single agent service | Replaced 6 services (Temporal, Temporal UI, router, 3 agent services) | ✓ Good — simpler ops (v2.3) |
| @anthropic-ai/sdk native tool-use | Full control over tracing, budgets, integration | ✓ Good — replaced all @langchain/* (v2.2) |
| Agentic loops over fixed graphs | LLMs reason about control flow instead of following graphs | ✓ Good — agents adapt to complexity (v2.2) |
| Orchestrator + sub-agents pattern | Focused sub-agents with isolated context | ✓ Good — keeps each agent's context small (v2.2) |
| Hybrid smart router | Deterministic fast-path for obvious events, LLM for ambiguous | ✓ Good — zero latency for common events (v2.2) |
| Separate dashboard service (Next.js) | Different lifecycle, resource profile, and dependency boundary from agent service | ✓ Good — clean separation, independent deployment (v2.4) |
| SSE over WebSockets | Unidirectional monitoring data, proxy-friendly, simpler than WS | ✓ Good — works through Nginx proxy, simple reconnection (v2.4) |
| Read-only Postgres access for dashboard | No new tables, no write paths; future API boundary via service layer | ✓ Good — one exception: agent_event_content table for inline LLM display (v2.4) |
| Agent service /api/ prefix for management endpoints | Separates management from operational endpoints, enables different auth policies | ✓ Good — 6 endpoints used by dashboard (v2.4) |
| Local schema mirrors for dashboard | Dashboard lib/schema.ts mirrors agents schema without importing @aesir/agents | ✓ Good — avoids heavy dependency tree in Next.js (v2.4) |
| Service layer as future API boundary | services/*.ts abstract all DB queries behind typed async functions | ✓ Good — clean migration path to dedicated API server (v2.4) |
| Constitutional + few-shot prompt style | Goal-oriented constraints and reasoning examples instead of procedural state machines | ✓ Good — removed 79+ imperative statements, agents adapt to novel situations (v2.5) |
| Task primitive as first-class entity | tasks/task_handoffs tables with 6 tools, not framework-imposed structure | ✓ Good — agents decide when to create tasks (v2.5) |
| X-Task-ID header for MCP correlation | Fire-and-forget outbound recording, non-fatal inbound lookup | ✓ Good — bidirectional correlation across all 3 integrations (v2.5) |
| Advisory lock for task event serialization | pg_advisory_xact_lock(hashtext(taskId)) prevents duplicate conversations | ✓ Good — concurrent event safety without external locks (v2.5) |
| Conversation reopening via reopen signal | Only reopen triggers terminal→queued transition, other signals still ignored | ✓ Good — safe and explicit, with world-state context injection (v2.5) |
| Task lifecycle in domain_knowledge (not constraints) | Task creation is judgment/goal, not safety boundary | ✓ Good — soft guidance per PROMPT_GUIDE.md (v2.5) |
| Hierarchy guardrails (depth 5, subtask 10, no circular delegation) | Prevents runaway task chains while allowing meaningful delegation | ✓ Good — fail-safe on broken chains (v2.5) |
| ReplyContext as opaque pass-through | Agents don't inspect replyContext — infrastructure determines channel | ✓ Good — agents truly channel-agnostic (v2.6) |
| Outbound denormalizer pattern | Single dispatch point translates domain actions to MCP calls | ✓ Good — exhaustive TypeScript switch on discriminated union (v2.6) |
| Communication tools over direct MCP | reply/ask/notify abstractions with Zod validation | ✓ Good — 39 tools, agents use intent not channel (v2.6) |
| Echo filter at adapter level | LINEAR_BOT_USER_ID env comparison, no API call | ✓ Good — zero per-webhook cost (v2.6) |
| Text-rendered options on all channels | ask() pre-renders options as text, no interactive buttons | ✓ Good — consistent behavior, simpler denormalizer (v2.6) |
| pgvector in PostgreSQL | No separate vector DB; pgvector handles knowledge + directory embeddings | ✓ Good — operational simplicity, sufficient for agent-scale volume (v2.7) |
| Peer-to-peer delegation via directory | Agents discover + delegate to each other; no central orchestrator | ✓ Good — no bottleneck, emergent topologies (v2.7) |
| Accept/reject handshake | Target agent evaluates delegation and accepts or rejects (30s timeout) | ✓ Good — strategy interface ready for future counter-propose (v2.7) |
| Focused briefs over full history | Delegated tasks carry description + expectations, not delegator's message history | ✓ Good — prevents context pollution, agents stay focused (v2.7) |
| TaskSignalDispatcher on terminal transitions | Completion signals fired when tasks reach completed/failed, with orphan fallback | ✓ Good — at-most-once delivery, completion_result JSONB preserves work (v2.7) |
| wait_for_task as separate tool | Auto-registers for all task-lifecycle signals; safety-by-design vs manual wait_for | ✓ Good — agents cannot forget to listen for timeout/failure (v2.7) |
| Knowledge classification taxonomy (6 types) | Fixed types with sensible defaults; avoids over-classification | ✓ Good — deduplication + expiry work well with fixed categories (v2.7) |
| Delegation-only agent pattern | QA agent has no triggers, started exclusively via task:delegate | ✓ Good — clean separation of concerns, Haiku for cost efficiency (v2.7) |
| Custom MCP retry loop over fetch-retry-ts | Library cannot classify permanent vs transient errors; custom loop enables HTTP status classification | ✓ Good — structured error context for agents (v2.8) |
| Channel-agnostic failure notifications via denormalizer | Replaces Linear-only emitErrorActivity(); single notifyFailure() at all 5 terminal paths | ✓ Good — consistent notification across all channels (v2.8) |
| Recovery context injection (non-fatal) | Agent resumes without context rather than failing; buildRecoveryContext() queries event log after last persistence point | ✓ Good — graceful degradation on crash (v2.8) |
| Dedup before echo filter ordering | Duplicates rejected regardless of actor; prevents false-positive echo classification on retransmitted webhooks | ✓ Good — correct layering (v2.8) |
| Client-side cost estimation | No server-side aggregation needed; pricing.ts utility with model-specific rates and Sonnet fallback | ✓ Good — simple, no new API (v2.8) |
| Entity correlation with fire-and-forget status propagation | Matches eventLog.append() pattern; correlation updates never block conversation execution | ✓ Good — zero-impact on critical path (v2.8) |
| Router disposition vocabulary (new/signal/retry/supersede/duplicate) | Formal routing decisions visible via event.routed; agents use work:query for data and reason naturally | ✓ Good — clear separation of router vs agent concerns (v2.8) |
| TimelineItem discriminated union (6 kinds) | tool_card, lifecycle_banner, llm_response, signal, sub_agent_lifecycle, generic — exhaustive rendering | ✓ Good — type-safe event rendering (v2.8) |
| Webhooks over polling | Cost/load savings; agents wake on events | ✓ Good |
| Full containerization | Reproducible environments | ✓ Good |
| PostgreSQL for persistence | Shared across all services | ✓ Good |
| Docker sandbox for code execution | Isolated test running, no host pollution | ✓ Good |
| Biome over ESLint/Prettier | Single tool for linting + formatting, faster | ✓ Good |
| pino for logging | Replace hand-rolled logging with maintained library | ✓ Good |
| 3-layer architecture | Platform → Integrations → Agents with clear boundaries | ✓ Good |
| MCP for agent-integration | HTTP-based tool calls, no SDK coupling in agents | ✓ Good |
| pnpm monorepo | Clear package boundaries, TypeScript project refs | ✓ Good |

## Principles

Lessons learned during development that guide future phases.

| Principle | Context |
|-----------|---------|
| Infrastructure phases must include consumer migration | Phase 19 created MCP servers but didn't wire agents to use them. When building infrastructure, include at least one consumer migration to validate end-to-end. |
| Pure library pattern for shared packages | @aesir/types should never validate env vars at import time. Services own their config and pass dependencies to libraries. |
| Agent-first problem solving | When an agent makes a wrong decision, fix the agent (prompts, tools, context) -- don't add deterministic overrides in workflow/activity code. |
| Prompts are first-class code | System prompts are the primary control surface for agent behavior. Test prompt changes against real scenarios. |
| Three-phase deletion order | Refactor references -> delete files -> remove deps. Prevents build breakage during large cleanups. |
| Archive before delete | Always create archive files before updating/deleting originals. Milestone completion creates roadmap + requirements archives first. |
| Local schema mirrors over cross-package imports | Dashboard mirrors agent schema locally to avoid importing @aesir/agents and its heavy dependency tree. Keep UI packages decoupled from backend internals. |
| Serialize at RSC boundaries | Date objects must be serialized as ISO strings before passing from server to client components. Enforce typed serialized interfaces at the boundary. |
| Static verification is necessary but insufficient | v2.5 code path tracing caught structural wiring issues, but 6 runtime bugs (migration journals, race conditions, deduplication, routing logic) only surfaced during live testing. Always validate E2E flows against running services. |
| Soft language for agent guidance | Task lifecycle, handoff quality, and delegation patterns use "prefer"/"tend toward" instead of MUST/ALWAYS/NEVER. Strong directives reserved for safety boundaries (wait_for, merge protection). |
| Domain abstraction over channel specifics | Agents should reason about intent (reply, ask, notify), not channels (Slack, Linear, GitHub). Infrastructure handles translation. Adding a new channel should not require agent prompt changes. |
| E2E testing catches what static verification misses | v2.7 live validation found 5 critical/major issues (orphan signals, depth tracking, timeout metadata) that code review and unit tests did not catch. Budget time for live validation of multi-agent workflows. |
| Hard constraints for critical agent behaviors | QA agent ended without completing tasks until a hard MUST constraint was added. For safety-critical tool calls (task:complete_task before end), strong directives earn their place. |

---
*Last updated: 2026-02-20 after v2.9 milestone start*
