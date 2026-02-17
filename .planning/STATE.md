# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.8 Resilience and Observability -- Phase 78 in progress

## Current Position

Phase: 78 of 78 (Work Correlation)
Plan: 2 of 6 in current phase
Status: Plan 78-02 complete
Last activity: 2026-02-17 -- Plan 78-02 complete (entityRef extraction in all three adapters)

Progress: [======>   ] 60%

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
| 77 | 01 | 7min | 2 | 9 |
| 77 | 02 | 3min | 2 | 4 |
| 77 | 03 | 4min | 2 | 2 |
| 77 | 04 | 2min | 2 | 3 |
| 77 | 05 | 5min | 2 | 4 |
| 78 | 01 | 3min | 2 | 9 |
| 78 | 02 | 5min | 2 | 4 |

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
- [Phase 77]: Migration 0013 needed: CHECK constraint from 0004 must be updated for new event types
- [Phase 77]: onMcpEvent added to ToolContext so mcpAdapter can thread it from worker loop to callMcpTool
- [Phase 77]: currentToolCallId tracked via closure in worker loop scope -- sequential tool calls within agent loop iteration
- [Phase 77]: SSE field fallback pattern (sse.field ?? default) for backward compatibility during parallel plan execution
- [Phase 77]: agent.retry_scheduled increments retryCount live via SSE handler for real-time metrics
- [Phase 77]: SubAgentPill color fallback via ?? AGENT_PILL_COLORS[0] for TypeScript noUncheckedIndexedAccess safety
- [Phase 77]: Two-pass groupTimelineEvents pipeline: index by toolCallId first pass, emit TimelineItems in second pass
- [Phase 77]: TimelineItem discriminated union with 6 kinds (tool_card, lifecycle_banner, llm_response, signal, sub_agent_lifecycle, generic)
- [Phase 77]: Static AGENT_DOT_COLORS array parallel to AGENT_PILL_COLORS for Tailwind build-time class scanning
- [Phase 77]: Failures filter is additive -- failed items show regardless of category filter when Failures chip is on
- [Phase 77]: LlmResponseRow extracted from EventItem; all other event kinds use specialized renderers
- [Phase 78]: Drizzle unique constraint mirrors SQL composite PK -- Drizzle ORM lacks composite PK support
- [Phase 78]: JSONB default uses {} object not '{}' string -- Drizzle types require matching TS type for defaults
- [Phase 78]: KNOWN_SIGNAL_TYPES as const array for discoverability without constraining signal type validation
- [Phase 78]: Linear issue.created/updated use fallback (payload.issueId ?? payload.id) for varying payload shapes
- [Phase 78]: GitHub entityRef uses owner/repo#number from payload repository, not config
- [Phase 78]: Slack block actions include entityRef only when threadTs present (conditional spread)

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
Stopped at: Completed 78-02-PLAN.md
Resume file: .planning/phases/78-work-correlation/78-02-SUMMARY.md
Next action: Execute 78-03-PLAN.md

---
*Updated: 2026-02-17 -- Plan 78-02 complete (entityRef extraction in Linear, GitHub, Slack adapters).*
