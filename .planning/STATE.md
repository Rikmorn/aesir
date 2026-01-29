# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** v2.2 Agentic Architecture -- Phase 28: Agentic Loop Runtime (COMPLETE)

## Current Position

Phase: 28 (first of 9 in v2.2) - Agentic Loop Runtime
Plan: 2 of 2
Status: Phase complete
Last activity: 2026-01-29 -- Completed 28-02-PLAN.md (core runAgentLoop() implementation and tests)

Progress: ██░░░░░░░░ 11% (2/18 plans)

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

Phase 28 decisions:
- Import PinoLogger from @aesir/platform (not directly from pino) -- consistent with codebase pattern
- Set error name in constructor body (not override readonly) -- TypeScript literal type narrowing constraint
- SDK resolved to ^0.72.0 (compatible with planned ^0.71.2)
- Cast betaZodTool result via unknown to Anthropic.Tool -- BetaRunnableTool union type too broad
- Use ToolDefinition.description directly instead of converted result -- exactOptionalPropertyTypes compat
- Build trace step as mutable then conditionally set stopReason -- exactOptionalPropertyTypes compat

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None blocking v2.2.

## Session Continuity

Last session: 2026-01-29
Stopped at: Completed 28-02-PLAN.md (Phase 28 complete)
Resume file: None
Next action: Execute Phase 29 plans (next phase in v2.2 roadmap)

---
*Updated: 2026-01-29 -- Completed Phase 28 (Agentic Loop Runtime: SDK, types, budget, errors, runAgentLoop)*
