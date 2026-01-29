# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** v2.2 Agentic Architecture -- Phase 28: Agentic Loop Runtime

## Current Position

Phase: 28 (first of 9 in v2.2) - Agentic Loop Runtime
Plan: Not started
Status: Ready to plan
Last activity: 2026-01-29 -- Roadmap created for v2.2 (9 phases, 78 requirements)

Progress: ░░░░░░░░░░ 0%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |

## Accumulated Context

### Decisions

v2.0/v2.1 decisions archived in milestones/.

v2.2 key decisions:
- Replace @langchain/* with @anthropic-ai/sdk for native tool-use
- Agentic tool-use loops replace LangGraph state machine graphs
- Orchestrator + focused sub-agents pattern for dev agent
- Hybrid smart router (deterministic rules + LLM for ambiguous events)
- Semantic context snapshots replace LangGraph checkpoint persistence
- In-process sub-agent spawning (nested function calls, not Temporal activities)
- Non-streaming LLM calls for backend agents in Temporal
- Custom `runAgentLoop()` over SDK's `toolRunner()` for control over tracing/budgets

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None blocking v2.2.

## Session Continuity

Last session: 2026-01-29
Stopped at: Roadmap created for v2.2 milestone
Resume file: None
Next action: Plan Phase 28 (Agentic Loop Runtime)

---
*Updated: 2026-01-29 -- v2.2 roadmap created (9 phases, 78 requirements mapped)*
