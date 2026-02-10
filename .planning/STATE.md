# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.7 Agent Collaboration -- Phase 67 (Linear Agent SDK) + Phase 68 (Shared Memory)

## Current Position

Phase: 67+68 of 73 (Linear Agent SDK + Shared Memory -- parallel)
Plan: 7 of ~24 total (~5+~4 in current phases)
Status: Phase 67 fully complete, Phase 68 plans 01+02 complete (parallel)
Last activity: 2026-02-10 -- Completed 68-02 (Embedding Pipeline)

Progress: [████░░░░░░] ~24%

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

## Performance Metrics

**Cumulative:**
- Total milestones shipped: 8
- Total phases completed: 69
- Total plans completed: 306

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 67 | 01 | 5min | 2 | 5 |
| 67 | 02 | 6min | 2 | 6 |
| 67 | 03 | 4min | 2 | 10 |
| 67 | 04 | 4min | 2 | 6 |
| 67 | 05 | 4min | 2 | 2 |
| 68 | 02 | 3min | 1 | 7 |

*Updated after each plan completion*

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.

- **67-01:** Retry at two levels -- factory handles HTTP retry, middleware handles credential coordination
- **67-01:** setTimeout chain over setInterval for proactive refresh (prevents overlapping checks)
- **67-01:** Best-effort Slack alerting -- alert failures never block token refresh
- **67-02:** update_session_state emits activities (not direct status mutation) because Linear SDK AgentSessionUpdateInput has no status field
- **67-02:** ActivityToolDeps uses PinoLogger (not MCPLogger) because withTokenRefresh requires richer interface
- **67-02:** STATUS_TO_ACTIVITY mapping provides default body messages for infrastructure-driven state transitions
- **67-03:** withTokenRefresh for acknowledgment thought (consistent 401 retry pattern across all Linear API calls)
- **67-03:** Action activities use action+parameter fields (not body) matching Linear SDK ActionActivityContent schema
- **67-03:** Single notify tool with intent parameter (reasoning|action) rather than separate tools
- **67-04:** Error activity emission in worker-loop.ts (not conversation-executor.ts) because failure transitions happen in the worker loop
- **67-04:** Three contextual error messages: token budget, agent abort, generic -- gives Linear users actionable feedback
- **67-04:** Dynamic import for callMcpTool in emitErrorActivity to avoid circular dependencies
- **67-05:** Resume activity uses type=thought (transitions Linear session to active state)
- **67-05:** Completion activity uses type=response (transitions Linear session to complete state)
- **67-05:** Resume fires after agent.resumed event but before task context injection for prompt state transition
- **67-05:** Completion fires before DB update so Linear reflects completion before conversation closes
- **68-02:** Voyage AI SDK timeoutInSeconds=10 via RequestOptions (SDK-native timeout, no AbortSignal needed)
- **68-02:** Ollama embedBatch uses Promise.all with sequential embed calls (no native batch support)

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

- Linear Agent SDK is developer preview -- feature flag (LINEAR_AGENT_SDK_ENABLED) needed for fallback
- Linear OAuth token migration deadline: April 1, 2026 (LSDK-02 must ship before)
- pgvector Docker image swap (pgvector/pgvector:pg15 replaces postgres:15-alpine) -- existing volumes compatible but needs verification

## Session Continuity

Last session: 2026-02-10
Stopped at: Completed 68-02-PLAN.md (Embedding Pipeline)
Resume file: None
Next action: Continue with Phase 68 plans 03-04

---
*Updated: 2026-02-10 -- 68-02 complete, embedding pipeline shipped*
