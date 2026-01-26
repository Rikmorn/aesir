# Phase 26: Dev Agent Workflow - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Dev-agent receives Linear issues (with "agent-ready" label), works in dev containers, and produces mergeable PRs. The agent researches the codebase, plans implementation, gets human approval, executes the plan, and handles PR review feedback. Container persists for the feedback loop.

**Reference:** See `.planning/2.1-rob-context.md` for full milestone vision, architecture diagrams, and example outputs.

</domain>

<decisions>
## Implementation Decisions

### Research Depth & Signals
- LLM self-assessment determines readiness to plan (no checklist or time-box)
- Confidence threshold (high/medium/low) included in plan artifact with reasoning
- If low confidence: agent proceeds but makes gaps visible in plan
- Reviewer can reject plan with "research X" pointer → triggers re-research phase
- V1 approach: Make confidence visible, learn from real usage what works

### Code Quality Bar
- Test coverage: Happy path only for V1 (main success case, skip edge cases)
- Error handling: Follow project standards → match nearby patterns → reasonable defaults (prompt-level, not hardcoded)
- Documentation: Always document — JSDoc for public APIs, inline comments for logic
- Test runs: Affected tests only (tests related to changed files), not full suite

### Failure Escalation
- Test failures: 3 self-fix attempts, then escalate
- Stuck on requirements/architecture: Notify both Slack AND Linear, wait for either response
  - If resolved in Slack, add conclusion to Linear for record
- Timeout: 24h wait → stop container (can resume if human responds later)
- Reminder: 72h gentle reminder in Slack if still unresolved
- CI failures: Auto-attempt fix (3 retries) BUT agent should recognize unfixable issues (env, infra) and escalate immediately without wasting retries

### Progress Updates
- **Slack (real-time):** Milestone updates only — research done, plan ready, PR created, feedback addressed, blockers/questions
- **Linear (permanent record):** Decisions only — plan posted for approval, blockers, final PR link
- No per-commit or per-phase-transition chatter (keep channels clean)

### Claude's Discretion
- Research exploration strategy (what to grep, which files to read)
- Commit granularity within execution
- Retry strategy specifics within the 3-attempt limit
- How to structure ResearchContext artifact

</decisions>

<specifics>
## Specific Ideas

- Agent works like a "competent junior developer" — not perfect, but reasonable and reviewable
- Container persists for feedback loop (PR review → more commits in same container)
- Research confidence becomes part of plan review (human can challenge under-researched plans)
- CI failure handling should be smart about what's fixable vs not (don't waste retries on env issues)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-dev-agent-workflow*
*Context gathered: 2026-01-26*
