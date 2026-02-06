# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.5 Agentic Conversations -- Phase 58.1 in progress

## Current Position

Phase: 58.1 of 59 (Task Schema and Service)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-06 -- Completed 58.1-01-PLAN.md (rename taskId to sandboxId)

Progress: [█░] 50% (Phase 58.1: 1/2 plans complete)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |
| v2.3 Unified Agent Framework | 2026-02-04 | 12 | 32 |
| v2.4 Operations Dashboard | 2026-02-05 | 8 | 22 |

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 4m 58s
- Total execution time: 24m 42s

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.

| ID | Decision | Phase |
|----|----------|-------|
| PROMPT-STRUCT-EXTEND | Extended prompt structure with domain_knowledge section between constraints and examples | 56-01 |
| PHASE-TAG-SIMPLIFY | Phase tags simplified to observability convention (framework doesn't parse them) | 56-01 |
| CONSTRAINT-COUNT | 6-7 constitutional constraints per orchestrator, zero directive stacking | 56-01, 56-02 |
| DROP-MODEL-NATIVE | 27 rules dropped as model-native per PROMPT_GUIDE.md Rule 7 (product-agent) | 56-01 |
| DROP-MODEL-NATIVE-DEV | 7 rules dropped as model-native (dev-agent) | 56-02 |
| WAIT-FOR-CONSTRAINT | wait_for added as explicit constraint (framework-critical, conversation dies without it) | 56-02 |
| ERROR-RECOVERY-DECOMP | Error recovery decomposed into 3 constraints + Example #3 (no diagnostic categories) | 56-02 |
| WORLD-STATE-XML-TAGS | World-state injection uses <world_state> XML tags in user message for reopen context | 57-01 |
| FIFO-EVICTION-TS | FIFO eviction on delivered_signal_ids done in TypeScript (not SQL) for pattern consistency | 57-01 |
| REOPEN-DIALOG-PLACEMENT | ReopenDialog placed in shared flex row with connection status indicator | 57-02 |
| QUEUED-SSE-ACTIVE | Added queued to SSE isActive check for early connection after reopen | 57-02 |
| SANDBOX-RENAME | ToolContext.taskId renamed to sandboxId to free taskId for v2.5 task primitive | 58.1-01 |
| CORRELATION-REF | Router query_conversations parameter renamed from taskId to correlationRef | 58.1-01 |

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-06T22:17Z
Stopped at: Completed 58.1-01-PLAN.md (rename taskId to sandboxId)
Resume file: None
Next action: Execute Phase 58.1 Plan 02 (Task Schema and Service)

---
*Updated: 2026-02-06 -- Phase 58.1 plan 01 complete (taskId renamed to sandboxId across agents package)*
