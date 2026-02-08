# Project Milestones: Aesir

## v2.5 Agentic Conversations (Shipped: 2026-02-08)

**Delivered:** Multi-conversation continuity through a task primitive that groups conversations with structured handoffs, conversation reopening for follow-up events, and goal-oriented prompt rewrites replacing procedural state machines

**Phases completed:** 56-59 (7 phases including 58.1-58.4, 17 plans total)

**Key accomplishments:**
- Goal-oriented agent prompts: rewrote product-agent and dev-agent from procedural state machines (79+ imperative statements) to constitutional constraints with few-shot reasoning examples
- Task primitive foundation: Postgres schema (tasks/task_handoffs), TaskService, 6 task tools (create/complete/pause/handoff/list/get_task_context), automatic context injection, hierarchy guardrails (depth 5, subtask 10, circular delegation prevention)
- Bidirectional task correlation across all 3 integrations: X-Task-ID header propagation through MCP, task_correlations tables, fire-and-forget outbound recording, non-fatal inbound webhook lookup
- Task-aware event routing with pg_advisory_xact_lock serialization, automatic conversation bootstrapping with task context enrichment, full backward compatibility
- Conversation reopening: reopen signal on completed/failed conversations with world-state injection, dashboard UI with contextual Reopen/Retry labels
- Agent prompt evolution: task lifecycle domain knowledge, role-specific handoff guidance, consumption examples, graceful degradation

**Stats:**
- 209 files created/modified (+25,594 / -3,892 lines)
- 88,011 lines of TypeScript total
- 7 phases, 17 plans, 68 requirements (68/68 satisfied, 1 deferred)
- 105 commits over 3 days (2026-02-05 → 2026-02-08)

**Git range:** `32d644d` → `5a42f70`

**What's next:** Stale task cleanup, evaluation tooling, dashboard tasks view, CI/CD pipeline, monitoring/alerting

---

## v2.4 Operations Dashboard (Shipped: 2026-02-05)

**Delivered:** Real-time visibility into agent execution through a developer-focused web dashboard -- conversations, tool usage, agent configurations, permission auditing, and system health, all with live SSE updates

**Phases completed:** 48-55 (8 phases, 22 plans total)

**Key accomplishments:**
- Agent service API extensions: four REST endpoints + SSE streaming for real-time agent events
- Next.js 15 dashboard infrastructure with Tailwind, shadcn/ui, Drizzle ORM, Docker/Nginx integration
- Conversations intelligence: filterable list with token aggregation and event timeline detail view with inline LLM content
- Agent definitions and tool visibility: runtime registry views, permission matrix with mismatch detection
- System overview with conversation status, worker health, recent errors, and token usage
- Real-time SSE event streaming across all views with reconnection, batched updates, and auto-scroll
- 6 post-phase UX enhancements: sidebar navigation, dark mode, tab URL persistence, enhanced prompt viewer, back links, time range filters

**Stats:**
- 199 files created/modified (+31,848 / -322 lines)
- 10,140 lines of dashboard TypeScript/TSX/CSS
- 8 phases, 22 plans, 52 requirements (52/52 satisfied)
- 104 commits over 2 days (2026-02-04 → 2026-02-05)

**Git range:** `7d9541f` → `a007b30`

**What's next:** Agent memory, cross-agent collaboration, CI/CD pipeline, monitoring/alerting

---

## v2.3 Unified Agent Framework (Shipped: 2026-02-04)

**Delivered:** Replaced Temporal workflows, per-agent services, and fragmented persistence with a Postgres-backed ConversationExecutor, declarative YAML agent definitions, and a unified event log -- cutting Docker services from 12 to 6 and removing ~21,590 lines of legacy code

**Phases completed:** 37-47.1 (12 phases, 32 plans total)

**Key accomplishments:**
- Postgres-backed ConversationExecutor with SKIP LOCKED claiming, heartbeat monitoring, wait_for pause/resume, and at-least-once execution replacing Temporal workflows
- Declarative agent definitions (YAML + prompt.md) with AgentRegistry and ToolRegistry -- new agent = new directory, zero code changes
- Unified event log (agent_events) with SessionProjection replacing three disconnected stores
- Three-phase history compaction with tool pruning, LLM summarization, and ground-truth artifact injection
- Single agent service replacing 6 Docker services (Temporal, Temporal UI, router, dev-agent, dev-agent-worker, product-agent)
- Sub-agent spawn tool wiring nested in-process agent loops with shared token budgets
- ~86 files and ~21,590 lines of legacy code removed (all Temporal, LangGraph, per-agent service code)

**Stats:**
- 343 files modified (+52,621 / -28,953, +23,668 net lines)
- 59,306 lines of TypeScript total
- 12 phases, 32 plans, 58 requirements (58/58 satisfied)
- 164 commits over 3 days (2026-02-01 → 2026-02-04)
- ~500+ new tests across framework components

**Git range:** `c676274` → `c482fa3`

**What's next:** Production readiness (CI/CD, monitoring, multi-environment), agent memory, cross-agent collaboration

---

## v2.2 Agentic Architecture (Shipped: 2026-01-31)

**Delivered:** Replaced LangGraph state machine architecture with agentic tool-use loops where LLMs make control flow decisions — agents reason, act, observe, and adapt instead of following predetermined graphs

**Phases completed:** 28-36 (9 phases, 30 plans total)

**Key accomplishments:**
- Core `runAgentLoop()` runtime with @anthropic-ai/sdk native tool-use powering all agents
- Dev agent orchestrator with sub-agents (researcher, coder, tester) replacing 13-node LangGraph graph
- Product agent as single adaptive agentic loop replacing 6-node LangGraph graph
- Smart router: hybrid deterministic + LLM event classification replacing hardcoded switches
- 25 typed tool definitions in 4 role-specific toolkits with error-as-data pattern
- Database-backed context snapshots and execution tracing with parent/child agent correlation
- All @langchain/* dependencies removed, 51 LangGraph files deleted
- Full guardrails: sandbox enforcement, merge protection, token budgets, cost tracking

**Stats:**
- 359 files modified (+27,586 net lines)
- 83,110 lines of TypeScript total
- 9 phases, 30 plans, 78 requirements (78/78 satisfied)
- 157 commits over 3 days (2026-01-29 → 2026-01-31)
- 926 tests passing across 56 test files

**Git range:** `dd26368` → `cbbb004`

**What's next:** Production readiness (CI/CD, monitoring, multi-environment) or new agent capabilities

---

## v2.1 Agents That Ship (Shipped: 2026-01-28)

**Delivered:** End-to-end automated development workflow where Slack messages become mergeable PRs through agent collaboration with human-in-the-loop approvals

**Phases completed:** 23-27 (5 phases, 46 plans total)

**Key accomplishments:**
- End-to-end workflow: Slack message → Linear issue → dev container → approved plan → merged PR
- Product Agent with Slack conversation, clarifying questions, and well-structured Linear issue creation
- Dev Agent with container-based execution, codebase research, execution planning, and PR creation
- Human-in-the-loop approvals via dual-channel (Linear comments + Slack buttons) with cross-channel sync
- Dev container infrastructure with persistent Docker containers and 24h inactivity cleanup
- Event infrastructure with webhook routing, normalized events, and integration-embedded dispatchers

**Stats:**
- 250 files modified
- +42,251 lines of TypeScript (84,065 total)
- 5 phases, 46 plans, 60 requirements
- 175 commits over 4 days (2026-01-25 → 2026-01-28)

**Git range:** `feat(23-01)` → `feat(27-12)`

**What's next:** Production deployment, agent intelligence improvements, multi-agent coordination

---

## v2.0 Foundation (Shipped: 2026-01-25)

**Delivered:** Full architectural restructure from "prove it works" to "maintainable and scalable" with 3-layer architecture, independent integrations, and MCP-based agent communication

**Phases completed:** 10-22 (14 phases, 104 plans total)

**Key accomplishments:**
- pnpm monorepo with 3-layer architecture (Platform → Integrations → Agents) and clear package boundaries
- Three independent integration packages (Linear, GitHub, Slack) with own databases, Dockerfiles, and lifecycles
- MCP layer with 19 tools across integrations enabling standardized HTTP-based agent communication
- Production-ready observability: pino logging with correlation IDs across all service boundaries
- One-command local development via Docker Compose with health checks, graceful shutdown, and watch mode
- Pure library architecture: @aesir/common refactored to have no env validation at import time

**Stats:**
- 659 TypeScript files
- 67,044 lines of TypeScript
- 14 phases, 104 plans, ~601 tasks
- 448 commits, 756 files changed (+100,526 net lines)
- 7 days (2026-01-19 → 2026-01-25)

**Git range:** `feat(10-01)` → `docs(22-05)`

**What's next:** Agent intelligence - smart requirements capture, intelligent questioning, quality ticket creation, great PRs, and iterating on what works

---

## v1 MVP (Shipped: 2026-01-19)

**Delivered:** End-to-end automated development platform where agents handle task → code → PR workflows with human-in-the-loop approval

**Phases completed:** 1-9, 9.1-9.3, e2e-verification (34 plans total)

**Key accomplishments:**
- LangGraph-based agents with safety guardrails (iteration limits, timeouts) and structured logging
- Docker sandbox for isolated code execution with test running and result capture
- Dev Agent workflow: Linear task → code generation → test feedback loop → GitHub PR
- Human-in-the-loop approval via Temporal workflows with signal handling for PR reviews
- Product Agent: Slack-based requirements gathering through conversation, creating structured Linear tasks
- Webhook-driven architecture via Cloudflare tunnel — agents wake on Linear/GitHub events (no polling)

**Stats:**
- 123 TypeScript files created
- 21,582 lines of TypeScript
- 13 phases, 34 plans
- 4 days from project start to ship (2026-01-15 → 2026-01-19)

**Git range:** `docs: initialize aesir` → `test(uat): complete milestone verification`

**What's next:** Production deployment, multi-LLM support, agent-to-agent review loops

---
