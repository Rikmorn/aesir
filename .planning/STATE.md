# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** v2.2 Agentic Architecture -- Phase 31 in progress

## Current Position

Phase: 31 (fourth of 9 in v2.2) - Dev Agent Orchestrator
Plan: 2 of 2
Status: Phase complete
Last activity: 2026-01-30 -- Completed 31-02-PLAN.md (orchestrator behavioral tests)

Progress: ██████████ 56% (10/18 plans)

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

Phase 29 decisions:
- Used text() with enum option for status/type columns -- ORM-level type safety without PostgreSQL enum types
- Generated snapshot via drizzle-kit, adapted for hand-written migration -- readable SQL + valid drizzle-kit tracking
- Alphabetized createId entries in ids.ts -- better scanability as list grows
- Synchronous callbacks with explicit flush() -- prevents trace recording from blocking agent loop
- Best-effort persistence -- DB errors during flush logged but not re-thrown
- tool_result traces deferred -- Phase 28 lacks onToolResult callback; four types sufficient for v2.2
- Context snapshots written at activity end, read at next activity start -- Temporal continuity
- camelCase-to-snake_case mapping helper for Drizzle ORM task updates
- CTXM-05 (sub-agent briefing) deferred to Phase 30/31 -- in-memory only per research decision

Phase 30 decisions:
- MAX_STDERR_BYTES (50KB) added alongside MAX_OUTPUT_BYTES (100KB) -- run_command truncates stdout/stderr separately
- Conditional property assignment for isError to respect exactOptionalPropertyTypes
- Biome enforces type imports before value imports in combined import statements
- Local Zod schemas for MCP tools (no imports from @aesir/integration-*) -- avoids cross-package coupling
- Namespaced tool display names (linear_, github_, slack_ prefixes) -- prevents LLM confusion between integrations
- Block Kit parameters omitted from Slack tools -- text-based messaging sufficient for agent communication
- Recursive runAgentLoop() for sub-agent spawning with shared TokenBudget -- keeps reference intact
- Sentinel HUMAN_INPUT_MARKER in tool result -- Temporal activity wrapper parses to pause workflow
- Integration tool filtering by name for orchestrator subset -- avoids duplicating tool configs
- Placeholder sub-agent system prompts in toolkits.ts -- detailed prompts deferred to Phase 31

Phase 31 decisions:
- XML-tagged prompt sections for structured LLM guidance (identity, constraints, workflow_guidance, sub_agent_delegation, error_recovery, available_tools)
- 3-tier complexity model in orchestrator prompt: simple/moderate/complex with adaptive behavior
- Cross-boundary import (shared/tools -> dev-agent/orchestrator) acceptable for agent-specific content
- SDK mocking over runAgentLoop mocking for behavioral tests -- enables full integration path testing
- Trace recorder onToolCall callback for assertion extraction -- cleaner than parsing mock results

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None blocking v2.2.

## Session Continuity

Last session: 2026-01-30
Stopped at: Completed 31-02-PLAN.md (orchestrator behavioral tests)
Resume file: None
Next action: Begin Phase 32 (Temporal Activities)

---
*Updated: 2026-01-30 -- Completed 31-02 (14 behavioral tests for orchestrator adaptive decisions)*
