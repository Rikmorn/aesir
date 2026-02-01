# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.3 Unified Agent Framework — Phase 37 in progress

## Current Position

Phase: 37 of 47 (Database Schema + Event Log Core)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-02-01 — Completed 37-01-PLAN.md (schema, migration, framework types)

Progress: [█░░░░░░░░░] ~3% (1/~30 estimated plans)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |

## Performance Metrics

**Velocity:**
- Total plans completed: 1 (v2.3)
- Average duration: 4m39s
- Total execution time: 4m39s

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 37 | 1/3 | 4m39s | 4m39s |

*Updated after each plan completion*

## Accumulated Context

### Decisions

v2.0/v2.1/v2.2 decisions archived in milestones/.

v2.3 decisions:
- Custom SKIP LOCKED executor over generic job queue (pg-boss/graphile-worker) -- conversation semantics don't map to generic job abstractions
- pg-boss for timeout scheduling only -- delayed signal delivery is a pure delayed-job problem
- JSONB messages column with persist-at-boundaries strategy -- avoids write amplification
- Gapless sequences per conversation (MAX(sequence) + 1) -- one loop at a time per conversation makes this safe
- Executor columns (claimed_by, claimed_at, last_heartbeat_at) added to conversations table in 37-01 migration -- avoids second migration in Phase 40
- ArtifactExtractionConfig uses Map<string, ArtifactExtractor> with payloadPath -- keeps Phase 37 independent of Phase 38 ToolRegistry

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
Stopped at: Completed 37-01-PLAN.md (schema, migration, framework types)
Resume file: None
Next action: Execute 37-02-PLAN.md (EventLog service implementation)

---
*Updated: 2026-02-01 — Completed plan 37-01*
