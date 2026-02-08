# Aesir

## What This Is

An agentic development platform that automates software development workflows -- from feature request to shipped code. A Postgres-backed conversation executor with declarative agent definitions. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage. Tasks provide multi-conversation continuity through structured handoffs, enabling agents to maintain context across interactions. Includes a real-time operations dashboard for monitoring agent execution, inspecting tool calls, auditing permissions, and viewing system health.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Current State

**Version:** v2.5 Agentic Conversations shipped (2026-02-08)

**Tech Stack:**
- TypeScript/Node.js monorepo (pnpm workspaces)
- ~88,000 lines across 8 packages
- @anthropic-ai/sdk for agentic tool-use loops
- Postgres-backed ConversationExecutor with SKIP LOCKED claiming (no Temporal)
- Declarative agent definitions (YAML + prompt.md) with AgentRegistry + ToolRegistry
- Unified event log (agent_events) with SessionProjection
- Task primitive with structured handoffs for multi-conversation continuity
- PostgreSQL for all persistence (conversations, events, sessions, tasks, credentials)
- Docker Compose for local development (7 services: PostgreSQL, nginx, 3 integrations, agent-service, dashboard)
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
- 34 tool factories in namespace:tool_name registry with ToolContext injection (including 6 task tools)
- Task primitive: multi-conversation continuity with structured handoffs, hierarchy guardrails (depth 5, subtask 10, circular delegation prevention)
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
- Real-time operations dashboard: conversations, agents, tools, system overview with SSE live updates
- Dashboard features: dark mode, sidebar navigation, permission matrix, inline LLM content, URL-persisted state, reopen/retry actions

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

### Active

**Candidates for next milestone:**
- [ ] Stale task cleanup: timeout signal mechanism for inactive tasks (TASK-26, deferred from v2.5)
- [ ] Prompt evaluation tooling (promptfoo, shadow mode)
- [ ] Dashboard tasks view (list tasks, task detail with grouped conversations and handoffs)
- [ ] CI/CD pipeline for deployment
- [ ] Monitoring and alerting for agent health
- [ ] Multi-environment configuration (dev/staging/prod)
- [ ] QA agent for automated code review
- [ ] Agent-managed memory (MemGPT/Letta style with memory:save/search tools)
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

### Out of Scope

- Full codebase indexing / RAG — agents explore via read_file/search_codebase tools; no vector DB needed
- UI for agent creation — code/config first, UI is future enhancement
- Streaming LLM responses — non-streaming appropriate for backend agents
- Multi-repo support — agents work on single configured repo; future enhancement
- Parallel sub-agents — sequential sub-agent execution is sufficient
- Full event sourcing library — append-only store with ~200 lines is sufficient

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

**Known Tech Debt (updated after v2.5):**
- Dispatcher route fallback defaults reference router:3006 instead of agent-service:3004 (22 occurrences; runtime correct via docker-compose)
- Two signal types (user_reply, cancel) defined in SIGNAL_AGENT_MAP but no adapter produces them (reserved for future)
- schema.drizzle.ts retains legacy table definitions (intentional, prevents destructive drizzle-kit migrations)
- 4 pre-existing test failures, 11 tests skipped pending infrastructure
- Run dev-agent container as non-root (infrastructure improvement)
- Self-referential FK (tasks.parent_id) handled by SQL migration only, not Drizzle references() — avoids TypeScript circular reference issue
- Prompts mention get_task_context but don't explicitly reference 4000-char truncation in injected task_context block

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

---
*Last updated: 2026-02-08 after v2.5 milestone*
