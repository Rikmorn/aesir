# Aesir

## What This Is

An internal agentic development platform that automates software development workflows — from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Current Milestone: v2.0 Foundation

**Goal:** Full architectural restructure from "prove it works" to "maintainable and scalable" — establishing clean layers, consistent tooling, and deployment infrastructure before adding more features.

**Target outcomes:**
- 3-layer architecture: Platform → Integrations → Agents with clear boundaries
- Normalized agent-integration communication (research MCP/REST/event-driven)
- Full testing pyramid with fast local dev and comprehensive CI
- Local + staging environments with deployment automation
- Developer tooling (.claude, cursor) that understands the architecture

## Requirements

### Validated

- [x] Product Agent: gathers requirements through conversation, creates structured Linear tasks — v1
- [x] Dev Agent: picks tasks, writes code and tests, updates Linear status, opens GitHub PRs — v1
- [x] Review loop: agents respond to PR feedback (from humans or other agents) — v1
- [x] Linear integration: read/update tasks via webhooks, agent appears as app identity — v1
- [x] GitHub integration: branches, commits, PRs, read comments, merge on approval — v1
- [x] Slack integration: notifications when human approval needed, status updates — v1
- [x] Human-in-the-loop support: Temporal workflows pause for approval/review — v1
- [x] Agent configuration: define agents via code/config files — v1
- [x] Logging/observability: all actions logged with timestamp, context, task ID — v1
- [x] Webhook-driven events: agents wake on Linear/GitHub events via Cloudflare tunnel — v1

### Active

**Architecture**
- [ ] Platform layer: state (PG), compute (Temporal/Lambda), secrets, orchestration, observability
- [ ] Integrations layer: Linear, GitHub, Slack as independent services with own lifecycles
- [ ] Agents layer: services with normalized protocol to integrations
- [ ] Agent-integration communication: research and implement (MCP, REST, event-driven, or hybrid)
- [ ] Service boundaries: clear interfaces, dependency injection patterns
- [ ] Configuration management: centralized, environment-aware

**Tooling & DX**
- [ ] Biome for linting and formatting (replace ESLint/Prettier)
- [ ] npm standardized (remove yarn.lock)
- [ ] Pre-commit hooks for code quality
- [ ] Testing pyramid: fast local tests, integration tests, full E2E suite
- [ ] Local dev simplification: one command spins up everything
- [ ] CI/CD pipeline with quality gates

**Code Quality**
- [ ] Consistent error handling patterns across codebase
- [ ] Type safety improvements (strict TypeScript)
- [ ] Module boundaries and dependency direction enforced
- [ ] Remove dead code, consolidate duplicates
- [ ] Replace hand-rolled utilities with maintained libs (pino for logging, etc.)

**Infrastructure**
- [ ] Docker image optimization
- [ ] Environment configuration: local + staging
- [ ] Secrets management (not scattered .env files)
- [ ] Deployment automation to staging
- [ ] dotenv-flow for consistent env var hierarchy

**Developer Tooling**
- [ ] .claude files updated to reflect architecture
- [ ] cursor files for AI tool understanding
- [ ] Documentation kept current (enforced by workflow, not CI)

### Deferred (post-v2.0)

- Multi-LLM flexibility: architecture will support, implementation deferred
- Agent-to-agent review loop: architecture supports multi-agent, implementation deferred to dedicated milestone
- Real-time status visibility: deferred to feature milestone
- Cost controls with token budgets: deferred to feature milestone
- Production deployment (prod environment): staging first, prod in future milestone

### Out of Scope

- Agentic QA — CI/CD via GitHub Actions is sufficient
- UI for agent creation — code/config first, UI is future enhancement
- Multi-workflow concurrency — single workflow at a time
- Full codebase indexing — HIGH complexity; context management is hard
- Multi-agent coordination implementation — architecture supports it, implementation is separate milestone
- Production environment — local + staging only for v2.0

## Context

**Current State (v1 shipped, needs restructure)**
- 21,582 lines of TypeScript across 123 files
- Code is coupled and messy (e.g., Linear auth script shared with GitHub)
- Testing E2E was painful, required many phases to address deployment afterthoughts
- Inconsistent env vars (.env.local vs .env), hand-rolled utilities
- Works but not maintainable at scale

**Tech Stack (current)**
- TypeScript/Node.js, LangGraph, Temporal
- Docker for sandboxing and containerization
- Linear SDK, Octokit (GitHub), Slack Bolt
- PostgreSQL (Temporal persistence + LangGraph checkpointer)
- Cloudflare tunnels for external webhook access

**Tech Stack (v2.0 additions/changes)**
- Biome (linting/formatting)
- pino (logging)
- dotenv-flow (env management)
- Research: MCP for agent-integration communication

**Team Background**
- TypeScript/Node experience with AWS deployment target
- No hard constraints on external integrations

**Philosophy**
- Agents should feel like coworkers using the same tools humans use
- Minimize context-switching — humans interact via Linear, GitHub, Slack
- Dedicated UI only for edge cases or when tool integrations don't suffice
- Right tool for the right job — open to different technologies for different needs
- Prefer well-maintained external libraries over hand-rolling

## Constraints

- **Multi-LLM**: Must support multiple providers (Claude, GPT-4, etc.) — avoids vendor lock-in
- **Tool Integration**: Must work with Linear, GitHub, Slack — these are non-negotiable existing tools
- **Coworker UX**: Agents appear in existing tools, not a separate system to learn
- **Full Containerization**: ALL services, scripts, and dependencies MUST run in Docker containers
  - No reliance on host machine setup beyond Docker and environment variables
  - Includes: agents, OAuth flows, webhook handlers, infrastructure services
  - External access via Cloudflare tunnels, NOT localhost URLs
  - Rationale: Reproducible environments, consistent execution, no "works on my machine" issues
- **Tunnel-First External Access**: External services (Linear, GitHub, Slack) reach our services via Cloudflare tunnels
  - Dashboard-configured tunnels (not config files) for simplicity
  - Separate tunnels per service acceptable for deployment flexibility
  - No localhost callback URLs in OAuth or webhook configurations
- **Service Independence**: Each integration (Linear, GitHub, Slack) is an independent service with own lifecycle
  - Can be deployed, scaled, updated independently
  - Swappable at runtime (e.g., GitHub → GitLab)
- **Documentation Currency**: All changes must include appropriate documentation updates
  - Enforced by workflow (Claude Code verifies before considering work done)
  - Not a CI gate, but a process requirement

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LangGraph for agent orchestration | StateGraph + checkpointing, good TypeScript support | ✓ Good |
| Temporal for durable workflows | Signal-based approval, built-in retry, activity binding | ✓ Good |
| Research-first approach | Evaluated platforms before building custom | ✓ Good |
| Agent creation via code/config | Simple, patterns now clear; UI can come later | ✓ Good |
| Webhooks over polling | Cost/load savings; agents wake on events | ✓ Good |
| MVP = single workflow | Proved the loop before scaling | ✓ Good |
| Full containerization | Reproducible environments | ✓ Good |
| Cloudflare tunnels for external access | Stable URLs for local dev webhooks | ✓ Good |
| PostgreSQL for persistence | Shared between Temporal and LangGraph checkpointer | ✓ Good |
| Docker sandbox for code execution | Isolated test running, no host pollution | ✓ Good |
| Linear OAuth with actor=app | Agent appears as app identity, not user | ✓ Good |
| v2.0 = full restructure | v1 proved concept but code is messy; fix foundation before adding features | — Pending |
| Biome over ESLint/Prettier | Single tool for linting + formatting, faster | — Pending |
| pino for logging | Replace hand-rolled logging with maintained library | — Pending |
| dotenv-flow for env management | Consistent .env hierarchy, no more .env.local vs .env confusion | — Pending |
| 3-layer architecture | Platform → Integrations → Agents with clear boundaries | — Pending |

## Principles

Lessons learned during development that guide future phases.

| Principle | Context |
|-----------|---------|
| Infrastructure phases must include consumer migration | Phase 19 created MCP servers but didn't wire agents to use them. When building infrastructure (APIs, services, servers), phase scope should include at least one consumer migration to validate the pattern works end-to-end. Success criteria should test observable behavior, not just capability. |

---
*Last updated: 2026-01-25 after Phase 22.2 context gathering*
