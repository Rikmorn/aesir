# Milestones — v1 to v2.9

This is the frozen milestone record for aesir's first eleven milestones: v1 MVP through v2.9 Platform Completion, spanning 2026-01-15 (project start) to 2026-02-23 (the last v2.9 commit). Ten of the eleven shipped, each with a git tag and an archived roadmap/requirements snapshot under `docs/history/milestones/`. The eleventh, v2.9, executed and passed verification but was never tagged, archived, or QA-tested before the repository went dormant — this file writes the narrative that milestone completion would otherwise have produced for it. The narrative follows each milestone's own contemporaneous record, which makes it a record of intent as much as of outcome: where that record disagrees with a phase's `*-VERIFICATION.md` or with an ADR about what shipped, those are the outcome of record.

Read it chronologically: each section gives the shipped date (or, for v2.9, the execution window), its phase and plan counts, its git tag, and three answers — what the milestone set out to do, what it actually proved or changed, and what debt it left behind. Only v2.8's record carries an explicit "Tech debt tracked" note; for the other nine shipped milestones, the nearest available signal is the "What's next" line each milestone recorded for itself, used here in its place. For phase-by-phase detail and verification status, see `docs/history/phases.md`. The GSD-era state files disagreed with each other on aggregate phase and plan totals for the ten shipped milestones — `docs/history/phases.md`'s own generated count, 97 phases across all eleven milestones, is the authoritative one. For the decisions behind each phase, `docs/history/decisions-log.md`; for the full per-requirement record, `docs/history/requirements.md`.

## v1 MVP

Shipped 2026-01-19, tag `v1`. Ran as 13 phases (the numbered range 1–9, sub-phases 9.1–9.3, and an e2e-verification phase) across 34 plans, in 4 days from project start (2026-01-15).

**What it set out to do:** deliver an end-to-end automated development platform where agents handle task → code → PR workflows with human-in-the-loop approval.

**What it proved or changed:**
- LangGraph-based agents with safety guardrails (iteration limits, timeouts) and structured logging
- A Docker sandbox for isolated code execution with test running and result capture
- The Dev Agent workflow: Linear task → code generation → test feedback loop → GitHub PR
- Human-in-the-loop approval via Temporal workflows with signal handling for PR reviews
- The Product Agent: Slack-based requirements gathering through conversation, creating structured Linear tasks
- A webhook-driven architecture via Cloudflare tunnel, so agents woke on Linear/GitHub events instead of polling

**Debt it left:** MILESTONES.md recorded no explicit tracked debt for v1; its "What's next" pointed at production deployment, multi-LLM support, and agent-to-agent review loops.

## v2.0 Foundation

Shipped 2026-01-25, tag `v2.0`. Ran as 14 phases (10–22) across 104 plans, in 7 days (2026-01-19 → 2026-01-25).

**What it set out to do:** a full architectural restructure from "prove it works" to "maintainable and scalable," with a 3-layer architecture, independent integrations, and MCP-based agent communication.

**What it proved or changed:**
- A pnpm monorepo with 3-layer architecture (Platform → Integrations → Agents) and clear package boundaries
- Three independent integration packages (Linear, GitHub, Slack), each with its own database, Dockerfile, and lifecycle
- An MCP layer with 19 tools across integrations, enabling standardised HTTP-based agent communication
- Production-ready observability: pino logging with correlation IDs across all service boundaries
- One-command local development via Docker Compose, with health checks, graceful shutdown, and watch mode
- A pure library architecture: `@aesir/common` refactored to do no env validation at import time

**Debt it left:** no tracked-debt note; its "What's next" pointed at agent intelligence — smart requirements capture, intelligent questioning, quality ticket creation, and iterating on what worked.

## v2.1 Agents That Ship

Shipped 2026-01-28, tag `v2.1`. Ran as 5 phases (23–27) across 46 plans and 60 requirements, over 4 days (2026-01-25 → 2026-01-28).

**What it set out to do:** an end-to-end automated development workflow where Slack messages become mergeable PRs through agent collaboration, with human-in-the-loop approvals.

**What it proved or changed:**
- The end-to-end workflow: Slack message → Linear issue → dev container → approved plan → merged PR
- The Product Agent conducting Slack conversation, asking clarifying questions, and creating well-structured Linear issues
- The Dev Agent doing container-based execution, codebase research, execution planning, and PR creation
- Human-in-the-loop approvals via dual-channel sync (Linear comments + Slack buttons)
- Dev container infrastructure: persistent Docker containers with 24h inactivity cleanup
- Event infrastructure: webhook routing, normalized events, and integration-embedded dispatchers

**Debt it left:** no tracked-debt note; its "What's next" pointed at production deployment, agent intelligence improvements, and multi-agent coordination.

## v2.2 Agentic Architecture

Shipped 2026-01-31, tag `v2.2`. Ran as 9 phases (28–36) across 30 plans and 78 requirements (78/78 satisfied), over 3 days (2026-01-29 → 2026-01-31).

**What it set out to do:** replace the LangGraph state-machine architecture with agentic tool-use loops, so LLMs make control-flow decisions instead of following predetermined graphs.

**What it proved or changed:**
- The core `runAgentLoop()` runtime, powering all agents on `@anthropic-ai/sdk` native tool-use
- The Dev Agent orchestrator with sub-agents (researcher, coder, tester), replacing a 13-node LangGraph graph
- The Product Agent as a single adaptive agentic loop, replacing a 6-node LangGraph graph
- A smart router: hybrid deterministic + LLM event classification replacing hardcoded switches
- 25 typed tool definitions across 4 role-specific toolkits, with an error-as-data pattern
- Every `@langchain/*` dependency removed, 51 LangGraph files deleted

**Debt it left:** no tracked-debt note; its "What's next" pointed at production readiness (CI/CD, monitoring, multi-environment) or new agent capabilities.

## v2.3 Unified Agent Framework

Shipped 2026-02-04, tag `v2.3`. Ran as 12 phases (37–47.1) across 32 plans and 58 requirements (58/58 satisfied), over 3 days (2026-02-01 → 2026-02-04).

**What it set out to do:** replace Temporal workflows, per-agent services, and fragmented persistence with a Postgres-backed ConversationExecutor, declarative YAML agent definitions, and a unified event log — cutting Docker services from 12 to 6.

**What it proved or changed:**
- A Postgres-backed ConversationExecutor with `SKIP LOCKED` claiming, heartbeat monitoring, and `wait_for` pause/resume, replacing Temporal workflows
- Declarative agent definitions (YAML + `prompt.md`) with an AgentRegistry and ToolRegistry — a new agent became a new directory, with zero code changes
- A unified event log (`agent_events`) with SessionProjection, replacing three disconnected stores
- Three-phase history compaction: tool pruning, LLM summarisation, and ground-truth artifact injection — as the milestone recorded it. ADR-0006 is the outcome of record here: artifact grounding is a property of the summarisation phase rather than a third phase, and the real third phase, agent-managed memory, was deferred and never built.
- A single agent service replacing 6 Docker services (Temporal, Temporal UI, router, dev-agent, dev-agent-worker, product-agent)
- Roughly 86 files and 21,590 lines of legacy code removed (all Temporal, LangGraph, and per-agent-service code)

**Debt it left:** no tracked-debt note; its "What's next" pointed at production readiness (CI/CD, monitoring, multi-environment), agent memory, and cross-agent collaboration.

## v2.4 Operations Dashboard

Shipped 2026-02-05, tag `v2.4`. Ran as 8 phases (48–55) across 22 plans and 52 requirements (52/52 satisfied), over 2 days (2026-02-04 → 2026-02-05).

**What it set out to do:** real-time visibility into agent execution through a developer-focused web dashboard, covering conversations, tool usage, agent configurations, permission auditing, and system health, all with live SSE updates.

**What it proved or changed:**
- Agent-service API extensions: four REST endpoints plus SSE streaming for real-time agent events
- Next.js 15 dashboard infrastructure with Tailwind, shadcn/ui, Drizzle ORM, and Docker/Nginx integration
- A conversations view: filterable list with token aggregation, plus an event-timeline detail view with inline LLM content
- Agent-definition and tool visibility: runtime registry views and a permission matrix with mismatch detection
- A system overview showing conversation status, worker health, recent errors, and token usage
- Real-time SSE event streaming across every view, with reconnection, batched updates, and auto-scroll

**Debt it left:** no tracked-debt note; its "What's next" pointed at agent memory, cross-agent collaboration, CI/CD pipeline, and monitoring/alerting.

## v2.5 Agentic Conversations

Shipped 2026-02-08, tag `v2.5`. Ran as 7 phases (56–59, including sub-phases 58.1–58.4) across 17 plans and 68 requirements (68/68 satisfied, 1 deferred), over 3 days (2026-02-05 → 2026-02-08).

**What it set out to do:** multi-conversation continuity through a task primitive that groups conversations with structured handoffs, conversation reopening for follow-up events, and goal-oriented prompt rewrites replacing procedural state machines.

**What it proved or changed:**
- Goal-oriented agent prompts: product-agent and dev-agent rewritten from procedural state machines (79+ imperative statements) into constitutional constraints with few-shot reasoning examples
- The task primitive foundation: a Postgres schema (`tasks`/`task_handoffs`), a TaskService, and 6 task tools, with automatic context injection and hierarchy guardrails (depth 5, subtask 10, circular-delegation prevention)
- Bidirectional task correlation across all 3 integrations, via an `X-Task-ID` header propagated through MCP
- Task-aware event routing with `pg_advisory_xact_lock` serialisation and automatic conversation bootstrapping
- Conversation reopening: a `reopen` signal on completed/failed conversations, with world-state injection and a dashboard UI
- Agent prompt evolution covering task lifecycle domain knowledge, role-specific handoff guidance, and graceful degradation

**Debt it left:** no tracked-debt note; its "What's next" pointed at stale task cleanup, evaluation tooling, a dashboard tasks view, and CI/CD pipeline.

## v2.6 Unified Agent Communication

Shipped 2026-02-09, tag `v2.6`. Ran as 7 phases (60–66, phase 64 absorbed into 63) across 16 plans and 45 requirements (42 satisfied, 1 dropped, 2 moved), over 2 days (2026-02-08 → 2026-02-09).

**What it set out to do:** domain-language communication primitives (`reply`/`ask`/`notify`) replacing channel-specific outbound tools, with full inbound `replyContext` propagation and outbound denormalization, so agents reason about intent while infrastructure handles channel translation.

**What it proved or changed:**
- A `ReplyContext` discriminated union (Slack/Linear/GitHub variants) threaded through the entire inbound pipeline
- An outbound denormalizer dispatching domain actions to the correct integration MCP tool by `replyContext` channel type
- Three communication tool factories (`communication:reply`, `communication:ask`, `communication:notify`) registered in the ToolRegistry
- New MCP tools: `linear:create_comment` exposed in the SDK server, `github:create_pr_comment` implemented full-stack
- dev-agent and product-agent definitions and prompts rewritten for domain-language communication
- Echo loop prevention: the Linear comment webhook filter drops agent-authored comments

**Debt it left:** no tracked-debt note; its "What's next" pointed at format translation (markdown-to-mrkdwn), stale task cleanup, evaluation tooling, a dashboard tasks view, and CI/CD pipeline.

## v2.7 Agent Collaboration

Shipped 2026-02-13, tag `v2.7`. Ran as 7 phases (67–73) across 26 plans and 49 requirements (48 satisfied, 1 deferred), over 4 days (2026-02-10 → 2026-02-13).

**What it set out to do:** multi-agent collaboration — agents discover each other by capability, delegate work through tasks with negotiation handshakes, signal completion reliably, and make the entire chain observable through the dashboard.

**What it proved or changed:**
- The Linear Agent SDK: agents authenticated as first-class Linear workspace entities (actor=app) with typed activities and proactive token refresh
- Shared Memory: a pgvector-backed knowledge store with 6 classification types, semantic search, mandatory expiry, and deduplication
- The Entity Directory: agents discovering each other by capability via semantic embedding matching
- Task Delegation: cross-conversation delegation with an accept/reject handshake, depth enforcement (max 5), and focused briefs instead of full message history
- Completion Signaling: a TaskSignalDispatcher firing on terminal task transitions, with orphan handling and `active_delegations` context preservation
- The QA Agent: a delegation-only agent (Haiku model, no triggers) validating the triangular product→dev→QA workflow

**Debt it left:** no tracked-debt note; its "What's next" pointed at agent resilience, stale task cleanup, prompt evaluation tooling, CI/CD pipeline, and monitoring/alerting.

## v2.8 Resilience and Observability

Shipped 2026-02-18, tag `v2.8`. Ran as 6 phases (74–79) across 22 plans and 33 requirements (33/33 satisfied), over 2 days (2026-02-16 → 2026-02-18).

**What it set out to do:** platform stabilisation before domain modelling — every failure visible and notified, the dashboard telling the complete story of every conversation, agents knowing what work exists before starting their own, and echo loops eliminated at the infrastructure level.

**What it proved or changed:**
- Echo elimination: a webhook dedup table with pg-boss 24h TTL cleanup, plus actor-based echo suppression across all 3 integrations
- MCP error classification: a custom retry loop replacing `fetch-retry-ts`, with permanent/transient HTTP classification and 4 new observability event types
- Channel-agnostic failure notifications at all 5 terminal failure paths via the denormalizer
- Recovery context injection on crash resume: `buildRecoveryContext()` querying the event log for work since the last persistence point
- Dashboard observability: 18 event types with distinct icons/colours, tool-call cards grouped by `toolCallId`, and sub-agent attribution pills
- Work correlation: an entity correlation registry with auto-registration at `executor.start()` and a disposition vocabulary (new/signal/retry/supersede/duplicate)

**Debt it left:** MILESTONES.md recorded this one explicitly — the `event.routed` sequence=0 collision (moderate: observability only, routing worked); `work:register`/`work:query` tools registered but absent from agent-definition YAML files (low: auto-registration worked); and 12 human verification items pending across Phases 77–79 (visual/interactive/live-stack testing).

## v2.9 Platform Completion

v2.9 ran from 2026-02-20 to 2026-02-23 and was never shipped. Seven of its eight planned phases — 80 Richer Negotiation, 81 Parallel Delegation, 82 Transparent Materialization, 83 Tree-Level Token Budgets, 84 Scheduled Execution, 86 Persistent Agent Identity, and 87 Knowledge Retrieval Enhancement — executed across 29 plans, and every one of them passed verification. The tag `v2.9` doesn't exist as of this writing; the reset that produced this record creates it, pointing at `39c7015c`, the last v2.9 commit (dated 2026-02-23, titled `docs(phase-83): complete phase execution` because phase 83 finished last, out of numeric order).

**What it set out to do:** complete every collaboration capability agents needed before v3.0 domain modelling — richer negotiation, parallel delegation, transparent materialization, tree-level budgets, scheduled execution, sub-agent discovery, persistent identity, and knowledge retrieval enhancement. Of the 58 requirements the milestone defined across its 8 phases, 51 belonged to the seven executed phases.

**What it proved or changed:**
- Richer negotiation: a counter-propose response type and `task:clarify`/`task:answer` tools, replacing the binary accept/reject handshake
- Parallel delegation: task groups with `all_required`/`any_sufficient`/`majority` completion policies, via `delegate_group`, `group_status`, and `cancel_group` tools
- Transparent materialization: a `materialization` parameter on task delegation that creates a linked Linear issue with bidirectional status sync
- Tree-level token budgets: spending tracked atomically across an entire delegation tree, queryable via `task:tree_budget`, with warning and hard-exhaustion signals
- Scheduled execution: cron-based agent triggers via pg-boss, with `skip`/`queue` overlap prevention and a manual-trigger API
- Persistent agent identity: versioned identity documents (12,000-character limit, 5-document cap per agent) injected into the system prompt, with `identity:update`/`identity:read` tools and lifecycle hooks
- Knowledge retrieval enhancement: a pluggable retrieval-strategy abstraction and a pre-compaction knowledge flush, so agents get a chance to persist important knowledge before history compaction discards it

**Debt it left:** Phase 85 (Sub-Agent Discovery) was deferred to v3.0. Its requirements assumed a separate `sub_agent` tier in the entity directory, but ROADMAP.md's phase record argued the real distinction agents need is activation pattern — spawn, delegate, trigger, schedule — not agent type; building a separate registry then would have created infrastructure that a future rethink of agent capabilities would just replace. A QA plan covering v2.8 and v2.9 end-to-end validation was written on 2026-02-23 but was never run (tracked as Rikmorn/aesir#2). And the milestone itself was never archived — no tag, no `MILESTONE-AUDIT.md`, no requirements/roadmap snapshot — because the repository went dormant immediately after phase 83 completed, until this reset resumed work on 2026-09-15.

---

Sources: `git show 39c7015c:.planning/MILESTONES.md`, `git show 39c7015c:.planning/STATE.md`, `git show 39c7015c:.planning/ROADMAP.md`, `git show 39c7015c:.planning/PROJECT.md`, `git tag -n3` (against the tag set once v2.9 exists).
