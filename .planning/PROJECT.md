# Aesir

## What This Is

An agentic development platform that automates software development workflows — from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Current State

**Version:** v2.0 Foundation shipped (2026-01-25)

**Tech Stack:**
- TypeScript/Node.js monorepo (pnpm workspaces)
- 67,044 lines across 659 files in 6 packages
- LangGraph for agent orchestration, Temporal for durable workflows
- PostgreSQL for all persistence (credentials, checkpoints, execution tracking)
- Docker Compose for local development with health checks and watch mode
- MCP (Model Context Protocol) for agent-integration communication

**Architecture:**
```
@aesir/agents (dev-agent, product-agent)
   ↓ HTTP/MCP
@aesir/integration-{linear,github,slack} (independent services)
   ↓ imports
@aesir/platform, @aesir/common (shared infrastructure)
```

**Key Capabilities:**
- Agents communicate with integrations via MCP HTTP protocol (19 tools across 3 services)
- Each integration has own database schema, Dockerfile, and lifecycle
- pino logging with correlation IDs across all service boundaries
- One-command startup: `docker compose up`

## Requirements

### Validated

**v1 MVP (shipped 2026-01-19):**
- [x] Product Agent: gathers requirements through conversation, creates structured Linear tasks
- [x] Dev Agent: picks tasks, writes code and tests, updates Linear status, opens GitHub PRs
- [x] Review loop: agents respond to PR feedback (from humans or other agents)
- [x] Linear integration: read/update tasks via webhooks, agent appears as app identity
- [x] GitHub integration: branches, commits, PRs, read comments, merge on approval
- [x] Slack integration: notifications when human approval needed, status updates
- [x] Human-in-the-loop support: Temporal workflows pause for approval/review
- [x] Agent configuration: define agents via code/config files
- [x] Logging/observability: all actions logged with timestamp, context, task ID
- [x] Webhook-driven events: agents wake on Linear/GitHub events via Cloudflare tunnel

**v2.0 Foundation (shipped 2026-01-25):**
- [x] 3-layer architecture: Platform → Integrations → Agents with clear boundaries
- [x] MCP-based agent-integration communication (19 tools across Linear, GitHub, Slack)
- [x] Independent integration packages with own databases and Dockerfiles
- [x] pnpm monorepo with TypeScript project references
- [x] pino logging with correlation IDs
- [x] PostgreSQL-backed credential storage with encryption
- [x] Testing infrastructure (testcontainers, MSW, factories)
- [x] One-command local dev via Docker Compose
- [x] Graceful shutdown and health checks

### Active

**v2.1 Agents That Ship:**
- [ ] Product-agent: Slack conversation → well-defined Linear issue
- [ ] Dev-agent: Linear issue → mergeable PR (container-based execution)
- [ ] Human-in-the-loop: Approvals and feedback loops

### Out of Scope

- Full codebase indexing — HIGH complexity; context management is hard
- UI for agent creation — code/config first, UI is future enhancement
- Production environment — local only for now
- Multi-agent coordination implementation — architecture supports it, dedicated milestone later

## Context

**Team Background:**
- TypeScript/Node experience with AWS deployment target
- No hard constraints on external integrations

**Philosophy:**
- Agents should feel like coworkers using the same tools humans use
- Minimize context-switching — humans interact via Linear, GitHub, Slack
- Right tool for the right job — open to different technologies
- Prefer well-maintained external libraries over hand-rolling

## Constraints

- **Multi-LLM**: Must support multiple providers (Claude, GPT-4, etc.)
- **Tool Integration**: Must work with Linear, GitHub, Slack — non-negotiable
- **Coworker UX**: Agents appear in existing tools, not a separate system
- **Full Containerization**: All services run in Docker containers
- **Tunnel-First External Access**: External services reach us via Cloudflare tunnels
- **Service Independence**: Each integration can be deployed/scaled independently
- **Documentation Currency**: Changes include documentation updates

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LangGraph for agent orchestration | StateGraph + checkpointing, good TypeScript support | ✓ Good |
| Temporal for durable workflows | Signal-based approval, built-in retry | ✓ Good |
| Webhooks over polling | Cost/load savings; agents wake on events | ✓ Good |
| Full containerization | Reproducible environments | ✓ Good |
| PostgreSQL for persistence | Shared between Temporal, LangGraph, credentials | ✓ Good |
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
| Pure library pattern for shared packages | @aesir/common should never validate env vars at import time. Services own their config and pass dependencies to libraries. |

## Current Milestone: v2.1 Agents That Ship

**Goal:** End-to-end working agents where feature requests become shipped code without manual intervention.

**Target features:**
- Product-agent receives Slack messages, asks clarifying questions, creates well-structured Linear issues
- Dev-agent receives Linear issues, works in dev container, produces mergeable PRs
- Human-in-the-loop approvals from both Linear and Slack
- Feedback loops for PR reviews and plan revisions

**Success bar:** Output quality matches "competent junior developer" - not perfect, but reasonable and reviewable.

**v2.1 Rule:** No phase is complete until its output is verified working in the full flow.

---
*Last updated: 2026-01-25 after v2.1 milestone start*
