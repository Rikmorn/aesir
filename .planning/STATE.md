# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.5 Agentic Conversations -- Phase 58.1 complete

## Current Position

Phase: 58.1 of 59 (Task Schema and Service)
Plan: 2 of 2 in current phase
Status: Phase complete
Last activity: 2026-02-06 -- Completed 58.1-02-PLAN.md (task schema and service)

Progress: [██] 100% (Phase 58.1: 2/2 plans complete)

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
- Total plans completed: 6
- Average duration: 5m 27s
- Total execution time: 32m 42s

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
| SELF-REF-FK | Self-referential FK (tasks.parent_id) handled in SQL migration only, not Drizzle references() | 58.1-02 |
| SERVICE-SHAPE-ONLY | TaskService validates data shape (Zod) only; business logic in tool layer (Phase 58.2) | 58.1-02 |
| INPUT-TYPES | Exported task param types use z.input<> for caller ergonomics with Zod defaults | 58.1-02 |

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-06T22:29Z
Stopped at: Completed 58.1-02-PLAN.md (task schema and service)
Resume file: None
Next action: Execute Phase 58.2 (Agentic Conversations -- agent task tools)

---
*Updated: 2026-02-06 -- Phase 58.1 complete (task tables, TaskService, ToolContext.taskId wired)*
