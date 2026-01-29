# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

**Current focus:** v2.2 Agentic Architecture — replacing LangGraph state machines with agentic tool-use loops

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-01-29 — Milestone v2.2 started

Progress: ░░░░░░░░░░ 0%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |

## Accumulated Context

### Decisions

v2.0 decisions archived in milestones/v2.0-ROADMAP.md.
v2.1 decisions archived in milestones/v2.1-ROADMAP.md.

Key decisions that carry forward:
- 3-layer architecture (Platform -> Integrations -> Agents) is established pattern
- MCP for agent-integration communication (HTTP-based, not direct SDK imports)
- Pure library pattern for @aesir/types (no env validation at import time)
- Infrastructure phases must include consumer migration (E2E verification requirements)
- Event type uses dotted notation (source.resource.action) for consistent parsing
- Integration-embedded dispatcher pattern: each integration dispatches its own events
- Dev container uses sleep infinity and Docker API exec for command execution
- Dual-channel approval: full plan to Linear (permanent record), summary to Slack (real-time buttons)
- Temporal signals for workflow continuation (planApproval, prFeedback)

v2.2 key decisions:
- Replace @langchain/* with @anthropic-ai/sdk for native tool-use
- Agentic tool-use loops replace LangGraph state machine graphs
- Orchestrator + focused sub-agents pattern for dev agent
- Smart router (LLM-based) replaces hardcoded event switches
- Semantic context snapshots replace LangGraph checkpoint persistence

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
   - commit-pr.test.ts - missing GitHub config mock
   - create-branch.test.ts - missing GitHub config mock
   - github-pr-review.test.ts - missing GitHub config mock
   - linear/integration.test.ts - module resolution issue

2. **Run dev-agent container as non-root** (infrastructure)
   - File: `.planning/todos/pending/2026-01-19-dev-agent-container-root-user.md`

3. **11 tests skipped pending infrastructure** (testing)
   - Cross-channel sync tests (pending MCP mock)
   - Workflow state transition tests (pending Temporal test framework)

### Blockers/Concerns

None blocking v2.2.

## Session Continuity

Last session: 2026-01-29
Stopped at: Milestone v2.2 initialization — defining requirements
Resume file: None
Next action: Complete requirements and roadmap definition

---
*Updated: 2026-01-29 — v2.2 Agentic Architecture milestone started*
