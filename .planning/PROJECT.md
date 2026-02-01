# Aesir

## What This Is

An agentic development platform that automates software development workflows — from feature request to shipped code. Agents reason about tasks, use tools to act, observe results, and adapt — operating like coworkers within existing business tools (Linear, GitHub, Slack), not as a separate system to manage.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Current State

**Version:** v2.2 Agentic Architecture shipped (2026-01-31)

**Tech Stack:**
- TypeScript/Node.js monorepo (pnpm workspaces)
- 83,110 lines across ~900 files in 7 packages
- @anthropic-ai/sdk for agentic tool-use loops, Temporal for durable workflows
- PostgreSQL for all persistence (credentials, context snapshots, execution traces, task state)
- Docker Compose for local development with health checks and watch mode
- MCP (Model Context Protocol) for agent-integration communication
- Smart router service for hybrid event classification (deterministic + LLM)

**Architecture:**
```
Smart Router (port 3006)
   ↓ routes events to
@aesir/agents (dev-agent, product-agent)
   ↓ HTTP/MCP
@aesir/integration-{linear,github,slack} (independent services)
   ↓ imports
@aesir/platform, @aesir/types (shared infrastructure)
```

**Key Capabilities:**
- Agentic tool-use loops: agents reason about what to do instead of following fixed graphs
- Dev agent orchestrator with focused sub-agents (researcher, coder, tester)
- Product agent adapts conversation strategy based on input clarity
- 25 typed tools in 4 role-specific toolkits with error-as-data pattern
- Hybrid event routing: deterministic fast-path + LLM slow-path
- Semantic context snapshots across Temporal activity boundaries
- Automatic execution tracing with parent/child agent correlation
- Guardrails: sandbox enforcement, merge protection, token budgets, cost tracking
- 926 tests passing across 56 test files

## Requirements

### Validated

**v1 MVP (shipped 2026-01-19):**
- ✓ Product Agent: gathers requirements through conversation, creates structured Linear tasks — v1.0
- ✓ Dev Agent: picks tasks, writes code and tests, updates Linear status, opens GitHub PRs — v1.0
- ✓ Review loop: agents respond to PR feedback (from humans or other agents) — v1.0
- ✓ Linear integration: read/update tasks via webhooks, agent appears as app identity — v1.0
- ✓ GitHub integration: branches, commits, PRs, read comments, merge on approval — v1.0
- ✓ Slack integration: notifications when human approval needed, status updates — v1.0
- ✓ Human-in-the-loop support: Temporal workflows pause for approval/review — v1.0
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
- ✓ Agent tool library: 25 tools in 4 role-specific toolkits (codebase, MCP, coordination) — v2.2
- ✓ Dev agent orchestrator with sub-agents (researcher, coder, tester) replacing 13-node LangGraph graph — v2.2
- ✓ Product agent as single adaptive agentic loop replacing 6-node LangGraph graph — v2.2
- ✓ Smart router: hybrid deterministic + LLM event classification replacing hardcoded switches — v2.2
- ✓ Context management: semantic snapshots replacing LangGraph checkpoints — v2.2
- ✓ Execution tracing with parent/child agent correlation — v2.2
- ✓ Guardrails: iteration limits, cost budgets, escalation with diagnosis — v2.2
- ✓ All @langchain/* dependencies removed, 51 LangGraph files deleted — v2.2

### Active

**Next milestone (TBD):**
- [ ] CI/CD pipeline for deployment
- [ ] Monitoring and alerting for agent health
- [ ] Multi-environment configuration (dev/staging/prod)
- [ ] Cross-agent collaboration (dev agent asks product agent to clarify mid-task)
- [ ] QA agent for automated code review

### Out of Scope

- Full codebase indexing / RAG — agents explore via read_file/search_codebase tools; no vector DB needed
- UI for agent creation — code/config first, UI is future enhancement
- Streaming LLM responses — non-streaming recommended for backend agents in Temporal
- Multi-repo support — agents work on single configured repo; future enhancement
- Parallel sub-agents — dev workflow is sequential; parallel adds complexity without benefit

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

**Known Tech Debt (from v2.2):**
- tool_result trace type not recorded (runAgentLoop lacks onToolResult callback)
- dev-agent/classification/approval.ts dead code (absorbed into router, file not deleted)
- Context snapshot JSONB fields have no size limits
- 4 pre-existing test failures, 11 tests skipped pending infrastructure

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
| LangGraph for agent orchestration | StateGraph + checkpointing, good TypeScript support | ✓ Replaced — agentic tool-use loops better (v2.2) |
| @anthropic-ai/sdk native tool-use | Full control over tracing, budgets, Temporal integration | ✓ Good — replaced all @langchain/* |
| Agentic loops over fixed graphs | LLMs reason about control flow instead of following predetermined graphs | ✓ Good — agents adapt to task complexity |
| Orchestrator + sub-agents pattern | Focused sub-agents (researcher, coder, tester) with isolated context | ✓ Good — keeps each agent's context small |
| Hybrid smart router | Deterministic fast-path for obvious events, LLM for ambiguous | ✓ Good — zero latency for common events |
| Semantic context snapshots | LLM self-summarization at activity boundaries | ✓ Good — replaced LangGraph checkpoint persistence |
| Temporal for durable workflows | Signal-based approval, built-in retry | ✓ Good |
| Webhooks over polling | Cost/load savings; agents wake on events | ✓ Good |
| Full containerization | Reproducible environments | ✓ Good |
| PostgreSQL for persistence | Shared between Temporal, agents, credentials | ✓ Good |
| Docker sandbox for code execution | Isolated test running, no host pollution | ✓ Good |
| v2.0 = full restructure | v1 proved concept; fix foundation before features | ✓ Good |
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
| Agent-first problem solving | When an agent makes a wrong decision, fix the agent (prompts, tools, context) — don't add deterministic overrides in workflow/activity code. |
| Prompts are first-class code | System prompts are the primary control surface for agent behavior. Test prompt changes against real scenarios. |

---
*Last updated: 2026-02-01 after v2.2 milestone*
