# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.3 Unified Agent Framework — Phase 37 ready to plan

## Current Position

Phase: 37 of 47 (Database Schema + Event Log Core)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-01 — Roadmap created (11 phases, 57 requirements mapped)

Progress: [░░░░░░░░░░] 0%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (v2.3)
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*

## Accumulated Context

### Decisions

v2.0/v2.1/v2.2 decisions archived in milestones/.

v2.3 decisions:
- Custom SKIP LOCKED executor over generic job queue (pg-boss/graphile-worker) -- conversation semantics don't map to generic job abstractions
- pg-boss for timeout scheduling only -- delayed signal delivery is a pure delayed-job problem
- JSONB messages column with persist-at-boundaries strategy -- avoids write amplification
- Gapless sequences per conversation (MAX(sequence) + 1) -- one loop at a time per conversation makes this safe

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)
4. **Delete dead code: dev-agent/classification/approval.ts** (addressed in Phase 47)
5. **Add onToolResult callback to runAgentLoop()** (addressed by v2.3 event log)
6. **Add JSONB size limits to context_snapshots** (addressed by v2.3 replacing context_snapshots)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-01
Stopped at: Roadmap created for v2.3 (Phases 37-47, 11 phases, 57 requirements)
Resume file: None
Next action: Plan Phase 37 (Database Schema + Event Log Core)

---
*Updated: 2026-02-01 — v2.3 roadmap created*
