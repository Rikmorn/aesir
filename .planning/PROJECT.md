# Aesir

## What This Is

An internal agentic development platform that automates software development workflows — from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools, not as a separate system to manage.

## Core Value

End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Product Agent: gathers requirements through conversation, creates structured Linear tasks
- [ ] Dev Agent: picks tasks, writes code and tests, updates Linear status, opens GitHub PRs
- [ ] Review loop: agents respond to PR feedback (from humans or other agents)
- [ ] MCP integrations: Linear (project management), GitHub (code/PRs/CI), Slack (communication)
- [ ] Human-in-the-loop support: async handoffs where agents wait for approval/review
- [ ] Multi-LLM flexibility: support Claude, GPT-4, and others without lock-in
- [ ] Agent configuration: define agents via code/config files
- [ ] Monitoring: visibility into agent workflows, status, and outputs
- [ ] Webhook-driven events: agents wake on tool events (PR review, task assignment) rather than polling

### Out of Scope

- Agentic QA — CI/CD via GitHub Actions is sufficient for MVP
- UI for agent creation — code/config first, UI is a future enhancement
- Multi-workflow concurrency — single workflow at a time for MVP
- Agents for other business units — prove the dev workflow first, then expand
- Building from scratch if existing solutions fit — research-first approach

## Context

**Team Background**
- TypeScript/Node experience, but open to other stacks if research indicates better fit
- AWS is the deployment home for custom code (infrastructure already scaffolded)
- No hard constraints on external integrations — will use hosted services if they fit

**Approach**
- Research-first: evaluate existing platforms, frameworks, and AWS-native options before committing to build
- The outcome might be: use existing platform, extend a framework, assemble from primitives, or build custom
- Cost-sensitive but value-driven — will pay for solutions that save significant build time

**Research Questions**
- What agentic platforms exist? (CrewAI, LangGraph, AutoGen, Semantic Kernel, etc.)
- What does AWS offer? (Bedrock Agents, Step Functions for orchestration)
- What orchestration patterns work for async human-in-loop workflows?
- How do existing tools handle MCP integrations?
- What's the cost/capability tradeoff landscape?

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
| Research-first approach | Prefer existing solutions over custom build if they fit | — Pending |
| Agent creation via code/config | Start simple, add UI later when patterns are clear | — Pending |
| Webhooks over polling | Cost and load considerations for async handoffs | — Pending |
| MVP = single workflow | Prove the loop before scaling concurrency | — Pending |
| Full containerization | Reproducible environments, no host dependencies | Adopted |
| Cloudflare tunnels for external access | External services can't reach localhost; tunnels provide stable URLs | Adopted |
| Dashboard-configured tunnels | Simpler setup, deployment flexibility with separate tunnels per service | Adopted |

---
*Last updated: 2026-01-19 after E2E UAT — added containerization and tunnel constraints*
