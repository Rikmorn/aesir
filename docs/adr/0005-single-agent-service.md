# ADR-0005: One agent service

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Before v2.3, the agent runtime ran as six separate Docker services: dev-agent, dev-agent-worker, product-agent, and the router, alongside Temporal and Temporal UI. Research across major agent frameworks — Claude Code, the OpenAI Agents SDK, CrewAI, LangGraph, Microsoft Agent Framework — found a consistent pattern: every one of them treats agents as parameterized instances of a single runtime (a Markdown file, a config object, a YAML definition), deployed as one process, not as separate services per agent type.

## Decision

Aesir runs one agent service — a single HTTP server, one port, one process — hosting every agent type through the `AgentRegistry` and `ToolRegistry`, replacing the separate dev-agent and product-agent services, the router service, and Temporal and Temporal UI.

## Consequences

- Docker services for the agent runtime dropped from 12 to 6.
- Adding a new agent type is a new definition directory, and new tool factories if it needs tools that don't exist yet — no new service, Dockerfile, or port.
- Operations got simpler, per the recorded outcome for this decision.
- Committed the project to a single-process deployment model for agents, aligned with the pattern observed across every major agent framework surveyed, rather than a microservice-per-agent-type model.

## Sources

- `git show v2.9:.planning/PROJECT.md`, `## Key Decisions`: row "Single agent service".
- `git show v2.9:.planning/MILESTONES.md`, `## v2.3 Unified Agent Framework (Shipped: 2026-02-04)` — "replacing 6 Docker services (Temporal, Temporal UI, router, dev-agent, dev-agent-worker, product-agent)".
- `docs/history/specs/2.3-spec-raw.md`, `### 5. Agent Registry + Single Service`, `#### Single Service`; Appendix `### A.2 Industry Research: How Agent Frameworks Handle Spawning & Deployment`.
