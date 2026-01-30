# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** v2.2 Agentic Architecture -- Phase 30 in progress

## Current Position

Phase: 30 (third of 9 in v2.2) - Agent Tool Library
Plan: 2 of 3
Status: In progress
Last activity: 2026-01-30 -- Completed 30-02-PLAN.md (MCP integration tools)

Progress: ██████░░░░ 39% (7/18 plans)

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

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None blocking v2.2.

## Session Continuity

Last session: 2026-01-30
Stopped at: Completed 30-02-PLAN.md (MCP integration tools)
Resume file: None
Next action: Continue Phase 30 Plan 03 (toolkit assembly)

---
*Updated: 2026-01-30 -- Completed 30-02 (MCP integration tools -- 19 tool factories with 20 tests)*
