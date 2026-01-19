# Aesir

## What This Is

An internal agentic development platform that automates software development workflows — from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

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

- [ ] Multi-LLM flexibility: support Claude, GPT-4, and others without lock-in
- [ ] Production deployment: AWS infrastructure, secrets management
- [ ] Agent-to-agent review loop: Dev Agent fixes based on Review Agent feedback
- [ ] Real-time status visibility while agent is running
- [ ] Cost controls with token budgets and attribution

### Out of Scope

- Agentic QA — CI/CD via GitHub Actions is sufficient for MVP
- UI for agent creation — code/config first, UI is a future enhancement
- Multi-workflow concurrency — single workflow at a time for MVP
- Agents for other business units — prove the dev workflow first, then expand
- Full codebase indexing — HIGH complexity; context management is hard

## Context

**Current State (v1 shipped)**
- 21,582 lines of TypeScript across 123 files
- LangGraph for agent orchestration, Temporal for durable workflows
- Docker sandbox for code execution, Cloudflare tunnel for webhooks
- Full E2E flow works: Linear task → Dev Agent → PR → Approval → Merge

**Tech Stack**
- TypeScript/Node.js, LangGraph, Temporal
- Docker for sandboxing and containerization
- Linear SDK, Octokit (GitHub), Slack Bolt
- PostgreSQL (Temporal persistence + LangGraph checkpointer)
- Cloudflare tunnels for external webhook access

**Team Background**
- TypeScript/Node experience with AWS deployment target
- No hard constraints on external integrations

**Philosophy**
- Agents should feel like coworkers using the same tools humans use
- Minimize context-switching — humans interact via Linear, GitHub, Slack
- Dedicated UI only for edge cases or when tool integrations don't suffice

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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LangGraph for agent orchestration | StateGraph + checkpointing, good TypeScript support | Good |
| Temporal for durable workflows | Signal-based approval, built-in retry, activity binding | Good |
| Research-first approach | Evaluated platforms before building custom | Good |
| Agent creation via code/config | Simple, patterns now clear; UI can come later | Good |
| Webhooks over polling | Cost/load savings; agents wake on events | Good |
| MVP = single workflow | Proved the loop before scaling | Good |
| Full containerization | Reproducible environments | Good |
| Cloudflare tunnels for external access | Stable URLs for local dev webhooks | Good |
| PostgreSQL for persistence | Shared between Temporal and LangGraph checkpointer | Good |
| Docker sandbox for code execution | Isolated test running, no host pollution | Good |
| Linear OAuth with actor=app | Agent appears as app identity, not user | Good |

---
*Last updated: 2026-01-19 after v1 milestone completion*
