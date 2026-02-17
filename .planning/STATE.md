# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.8 Resilience and Observability -- Phase 76 in progress

## Current Position

Phase: 76 of 78 (Runtime Resilience)
Plan: 3 of 3 in current phase
Status: Phase 76 complete
Last activity: 2026-02-17 -- Plan 76-03 complete (recovery context injection)

Progress: [=====.....] 50%

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |
| v2.3 Unified Agent Framework | 2026-02-04 | 12 | 32 |
| v2.4 Operations Dashboard | 2026-02-05 | 8 | 22 |
| v2.5 Agentic Conversations | 2026-02-08 | 7 | 17 |
| v2.6 Unified Agent Communication | 2026-02-09 | 7 | 16 |
| v2.7 Agent Collaboration | 2026-02-13 | 7 | 26 |

## Performance Metrics

**Cumulative:**
- Total milestones shipped: 9
- Total phases completed: 73
- Total plans completed: 330

*v2.8 metrics will be tracked as plans complete*

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 74 | 02 | 3min | 2 | 9 |
| 74 | 03 | 2min | 1 | 1 |
| 74 | 01 | 4min | 2 | 4 |
| 75 | 01 | 3min | 2 | 6 |
| 75 | 02 | 3min | 2 | 3 |
| 75 | 03 | 6min | 2 | 13 |
| 76 | 01 | 7min | 2 | 8 |
| 76 | 02 | 5min | 2 | 4 |
| 76 | 03 | 5min | 2 | 10 |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.
- [Phase 74]: Removed communication:notify from all test agents -- aligns with v2.7 anti-pattern lesson
- [Phase 74]: Return informational content (not isError) for empty tool state -- lets agents reason naturally
- [Phase 74]: Use z.string().min(1) for agentType validation -- subAgents mapping already validates role
- [Phase 75]: Source prefix extraction uses first segment before colon for dedup namespacing
- [Phase 75]: Dedup layer checked before echo layer -- duplicates rejected regardless of actor
- [Phase 75]: DB errors in dedup throw (fail-loud) rather than silently accepting
- [Phase 75]: Linear normalizer changes pre-completed in Plan 01 -- no duplicate commit for Plan 02
- [Phase 75]: GitHub sender extracted from raw JSON.parse, not Zod schema -- passthrough only
- [Phase 75]: Block action events excluded from Slack actorInfo -- user-initiated by definition
- [Phase 75]: pg-boss schedule:true enables cron for dedup cleanup while keeping send+startAfter for timeouts
- [Phase 75]: getBoss() returns undefined before start() to prevent premature job scheduling
- [Phase 76]: Replaced fetch-retry-ts with custom retry loop -- library cannot classify permanent vs transient errors
- [Phase 76]: Full jitter for retry delays (simpler, sufficient for 3-attempt budget)
- [Phase 76]: 429 Retry-After > 10s returns error immediately to avoid blocking agents
- [Phase 76]: Application-level errors (200 + isError) classified as permanent
- [Phase 76]: notifyFailure replaces emitErrorActivity entirely -- channel-agnostic via denormalizer
- [Phase 76]: Drain timeout aborts via AbortController; aborted conversations re-enqueue naturally
- [Phase 76]: pg-boss stopped before drain wait; health endpoint returns 503 during shutdown
- [Phase 76]: getSequence() added to EventLog interface for in-memory sequence retrieval (no DB round-trip)
- [Phase 76]: Recovery context injection non-fatal (try/catch) -- agent resumes without context rather than failing
- [Phase 76]: 6 persistence boundaries for last_persisted_sequence (plan specified 5, queued-signal-at-pause also persists)

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)
4. **Linear OAuth token migration** -- deadline April 1, 2026 (LSDK-02 shipped)

### Blockers/Concerns

- Linear Agent SDK is developer preview -- feature flag (LINEAR_AGENT_SDK_ENABLED) may be needed for fallback
- Linear OAuth token migration deadline: April 1, 2026
- Echo suppression: fully operational (Phase 75 complete) -- dedup + echo filter wired into routeEvent pipeline
- Recovery context + history compaction boundary coordination: last_persisted_sequence tracks checkpoint; recovery queries afterSequence
- Work correlation routing precedence vs. SIGNAL_AGENT_MAP needs decision during Phase 78 planning

## Session Continuity

Last session: 2026-02-17
Stopped at: Completed 76-03-PLAN.md (Phase 76 complete)
Resume file: .planning/phases/76-runtime-resilience/76-03-SUMMARY.md
Next action: Begin Phase 77

---
*Updated: 2026-02-17 -- Phase 76 complete (runtime resilience: MCP retry, failure notification, graceful shutdown, recovery context)*
