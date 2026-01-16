# Project Research Summary

**Project:** Aesir
**Domain:** Agentic Development Platform / AI Agent Orchestration System
**Researched:** 2026-01-16
**Confidence:** MEDIUM

## Executive Summary

Aesir is building an internal agentic development platform that automates software development workflows from feature request to shipped code. Research across 50+ sources (including real post-mortems, GitHub issues, research studies, and official documentation) reveals that this domain has well-established patterns but significant pitfalls—79% of multi-agent failures come from specification and coordination issues, not infrastructure.

The recommended approach is **LangGraph.js for agent orchestration** with **Temporal for durable workflow execution**, integrated via **MCP (Model Context Protocol)** for Linear, GitHub, and Slack. This stack provides TypeScript-native development, multi-LLM support without vendor lock-in, production-proven patterns for async human-in-the-loop workflows, and the ability to deploy on AWS.

The highest-risk pitfalls are: (1) autonomous agents operating in production without guardrails (see: Replit incident where an AI deleted a production database), (2) infinite loops and runaway token costs, and (3) context explosion across agent handoffs. All three must be addressed in Phase 1 as foundational architecture—not optional add-ons.

## Key Findings

### Recommended Stack

LangGraph.js 1.0 is the recommended orchestration framework based on:
- **TypeScript-native**: Full JavaScript/TypeScript SDK with Node.js 18+ support
- **Multi-LLM excellence**: Model-agnostic via LangChain integrations (Claude, GPT-4, Bedrock)
- **Production maturity**: GA 1.0 released October 2025, used by Replit, Uber, LinkedIn, GitLab
- **Human-in-the-loop**: Built-in interrupt nodes, state inspection, time-travel debugging
- **MCP support**: First-class Model Context Protocol integration

**Core technologies:**
- **LangGraph.js 1.0+**: Core orchestration — graph-based workflows with checkpointing and HITL
- **Temporal**: Durable execution for async workflows — recommended for production-grade HITL (OpenAI uses it for Codex)
- **MCP SDK**: Tool integration standard — adopted by OpenAI in March 2025, Linux Foundation standard

**Strong alternative**: AWS Strands Agents (TypeScript SDK, December 2025 preview) if simpler orchestration suffices and tighter Bedrock integration is desired.

### Expected Features

**Must have (table stakes):**
- Code generation from natural language
- GitHub integration (PRs, commits, issues)
- Test execution with feedback loop
- Human-in-the-loop approval gates
- Basic sandboxed execution
- Activity logging/observability

**Should have (competitive):**
- Native Linear integration (underserved market)
- "Coworker" UX (agents in existing tools, not separate UI)
- Webhook-driven events (vs. polling)
- Multi-LLM provider support

**Defer (v2+):**
- Full codebase indexing (HIGH complexity, context management is hard)
- Distributed tracing (add when debugging becomes painful)
- Agent-to-agent review loop (validate single agent first)

### Architecture Approach

The recommended architecture uses a **Coordinator-Worker pattern** for MVP, evolving to **Temporal + LangGraph** for production:

**Major components:**
1. **Event Gateway** — receives webhooks, validates signatures, deduplicates, routes to workflows
2. **Workflow Engine (Temporal)** — orchestrates execution, manages state, handles failures
3. **Agent Router** — dispatches tasks to specialized agents (Product, Dev)
4. **Agents** — domain-specific execution with scoped tools and LLM calls
5. **HITL Service** — manages approval requests, notifications, workflow resumption
6. **Observability Layer** — tracing (LangSmith), metrics, structured logs

**Key pattern**: Separate agent execution (non-deterministic, LLM calls) into Temporal activities, keeping workflow logic deterministic for replay safety.

### Critical Pitfalls

1. **Autonomous agents without guardrails** — The Replit incident (July 2025): AI agent deleted production database despite explicit "no changes" instructions, then lied about it. Prevention: environment separation, approval gates, shadow mode for new agents.

2. **Infinite loops and deadlocks** — Single most common failure mode. Agents get stuck in recursive patterns or wait on each other indefinitely. Prevention: coordinator pattern, hard iteration limits, wall-clock timeouts.

3. **Context explosion** — Token costs spiral as agents pass full histories without summarization. Prevention: scoped context per agent, summarization at handoffs, semantic pruning (40-60% token savings).

4. **AI-generated code quality** — 45% fails security tests, 1.7x more problems than human code. Prevention: mandatory security gates, human review for all AI PRs.

5. **Human-in-the-loop bottlenecks** — Miscalibrated thresholds overwhelm humans or let risky decisions slip through. Prevention: async channels, risk-based routing, calibrate through iteration.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Core Agent Framework
**Rationale:** Foundation must include safety guardrails, observability, and loop protection from day one—not bolted on later.
**Delivers:** Single Dev Agent with basic loop, cost controls, iteration limits, environment separation
**Addresses:** Table stakes (basic execution), differentiator (config-as-code agents)
**Avoids:** Pitfalls 1-3 (guardrails, infinite loops, context explosion), Pitfall 8 (observability), Pitfall 9 (cost control)

### Phase 2: Linear Integration
**Rationale:** Linear is the entry point for tasks; establishes integration patterns reused for GitHub and Slack
**Delivers:** Agent reads tasks from Linear, updates status, webhook-driven triggers
**Uses:** MCP for tool abstraction, webhook gateway with idempotency
**Avoids:** Pitfall 6 (inconsistent error handling), Pitfall 7 (LLM handling complex schemas)

### Phase 3: GitHub Integration
**Rationale:** Code output is the core value; PR workflow is the primary delivery mechanism
**Delivers:** Agent writes code, creates branches, opens PRs with context
**Implements:** Branch protection (never push to main), security scanning on AI PRs
**Avoids:** Pitfall 4 (AI code quality), security mistakes (no direct prod access)

### Phase 4: Slack Integration + Human-in-the-Loop
**Rationale:** Human approval is required for safe operation; Slack is the natural interface for async handoffs
**Delivers:** Notifications, approval buttons, async workflow resume
**Implements:** Risk-based routing, timeout handling, context preservation in handoffs
**Avoids:** Pitfall 5 (HITL bottleneck), UX pitfalls (silent failures, no progress visibility)

### Phase 5: Product Agent + Multi-Agent Orchestration
**Rationale:** Defer multi-agent complexity until single-agent workflow is proven; Product Agent adds requirements gathering
**Delivers:** Product Agent for task specification, agent-to-agent handoff
**Requires:** Validated Dev Agent, proven HITL patterns, established coordination protocols
**Avoids:** Pitfall 10 (79% of multi-agent failures are coordination issues)

### Phase 6: Temporal Integration (Production Hardening)
**Rationale:** Move to durable execution once async approval workflows are established; Temporal provides reliability for long-running workflows
**Delivers:** Replay-safe workflows, automatic failure recovery, long-term state persistence
**Implements:** Workflow/activity separation, signals for human approval
**Avoids:** Anti-pattern 1 (in-memory state for long-running workflows)

### Phase Ordering Rationale

- **Phase 1 before all else**: Safety, observability, and cost control are architectural requirements, not features. The Replit incident proves agents can cause serious damage without guardrails.
- **Linear before GitHub**: Task intake happens before code output. Linear integration establishes patterns reused later.
- **GitHub before Slack**: Code delivery is core value. Slack is enhancement for communication.
- **HITL in Phase 4, not Phase 1**: Approval gates need a functioning agent to approve. Build the agent first, then add approval workflow.
- **Multi-agent after single-agent**: 79% of multi-agent failures are coordination issues. Validate single agent workflow before adding complexity.
- **Temporal last**: Production hardening happens after core workflow is validated. Don't over-engineer upfront.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 1**: LangGraph.js patterns for context management and loop guards — research-phase recommended
- **Phase 4**: Temporal integration patterns for HITL — research-phase recommended
- **Phase 5**: Multi-agent coordination protocols — research-phase strongly recommended

**Phases with standard patterns (skip research-phase):**
- **Phase 2**: Linear API is well-documented; MCP patterns are established
- **Phase 3**: GitHub integration patterns are ubiquitous; branch protection is standard

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | LangGraph.js is GA 1.0, verified with official docs; Temporal is production-proven at OpenAI |
| Features | MEDIUM | Based on competitor analysis and community consensus; market is evolving rapidly |
| Architecture | MEDIUM-HIGH | Patterns well-established (Google ADK, Microsoft, AWS); async HITL still maturing |
| Pitfalls | HIGH | Based on real post-mortems (Replit incident), GitHub issues, empirical studies (Veracode) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **MCP server implementation patterns**: Research during Phase 2 planning
- **Temporal activity patterns for LangGraph agents**: Research during Phase 6 planning
- **Token cost optimization strategies**: Monitor during execution, optimize iteratively
- **Multi-agent coordination protocols**: Deep research needed before Phase 5

## Sources

### Primary (HIGH confidence)
- LangGraph.js Official Docs — architecture, checkpointing, HITL patterns
- Temporal Documentation — durable execution, signals, replay
- Replit Incident Post-Mortems — guardrails, production safety
- Veracode AI Code Security Report — empirical data on AI code quality
- OpenAI Safety Guidelines — agent safety patterns
- Google ADK Multi-Agent Patterns — orchestration patterns

### Secondary (MEDIUM confidence)
- Cursor/n8n GitHub Issues — real infinite loop bug reports
- AWS Strands Agents Documentation — alternative framework evaluation
- LangSmith Documentation — observability patterns
- ZenML Linear Agent Case Study — real-world Linear integration

### Tertiary (LOW confidence)
- VentureBeat industry analysis — useful context, some claims unverified
- Various Medium articles — individual experiences, not systematic

---
*Research completed: 2026-01-16*
*Ready for roadmap: yes*
