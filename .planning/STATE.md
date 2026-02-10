# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.7 Agent Collaboration -- Phase 71 (Completion Signaling) in progress

## Current Position

Phase: 71 of 73 (Completion Signaling)
Plan: 1 of 3 in phase (plan 01 complete)
Status: Phase 71 plan 01 complete, continuing with plan 02
Last activity: 2026-02-10 -- Plan 71-01 complete (multi-type wait_for, signal matching, wait_for_task)

Progress: [███████░░░] ~75%

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
- Total phases completed: 70
- Total plans completed: 315

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 67 | 01 | 5min | 2 | 5 |
| 67 | 02 | 6min | 2 | 6 |
| 67 | 03 | 4min | 2 | 10 |
| 67 | 04 | 4min | 2 | 6 |
| 67 | 05 | 4min | 2 | 2 |
| 68 | 01 | 4min | 2 | 7 |
| 68 | 02 | 3min | 1 | 7 |
| 68 | 03 | 6min | 2 | 9 |
| 68 | 04 | 3min | 2 | 5 |
| 69 | 01 | 2min | 2 | 6 |
| 69 | 02 | 6min | 2 | 7 |
| 69 | 03 | 6min | 2 | 4 |
| 70 | 01 | 5min | 2 | 12 |
| 70 | 02 | 3min | 2 | 4 |
| 70 | 03 | 2min | 2 | 4 |
| 71 | 01 | 9min | 2 | 14 |

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
- **68-01:** customType for unconstrained vector -- Drizzle built-in vector() requires fixed dimensions, customType allows 768/1024 without schema changes
- **68-01:** Ollama via Docker profile ("embedding") -- keeps default docker compose up unchanged
- **68-01:** text placeholder in schema.drizzle.ts -- drizzle-kit CJS bundler cannot resolve customType
- **68-02:** Voyage AI SDK timeoutInSeconds=10 via RequestOptions (SDK-native timeout, no AbortSignal needed)
- **68-02:** Ollama embedBatch uses Promise.all with sequential embed calls (no native batch support)
- **68-03:** cosineDistance from drizzle-orm for pgvector similarity queries (1 - cosineDistance = similarity score)
- **68-03:** Scope visibility as SQL condition (not application-level filtering) for row-level security
- **68-03:** EmbeddingConfig.voyage.apiKey changed from optional property to explicit string|undefined for exactOptionalPropertyTypes compatibility
- **68-04:** setInterval over pg-boss cron for cleanup (TimeoutScheduler doesn't expose boss instance, single-process deployment)
- **68-04:** Cleanup as first shutdown step (stop generating new work before draining existing)
- **69-01:** Agent entries use definition ID as PK; directoryEntry ID generator for future human entries only
- **69-01:** Unconstrained vector for capabilities_embedding (matches knowledge_entries pattern, supports 768/1024)
- **69-01:** HNSW index m=16, ef_construction=64 matches knowledge_entries for consistent pgvector configuration
- **69-02:** ne() for self-exclusion in directory:find (consistent drizzle-orm operator usage)
- **69-02:** directory_get does not take ToolContext (no ctx.agentId needed, unlike find)
- **69-03:** Knowledge tools added alongside directory tools to orchestrators for Phase 70+ delegation workflows
- **69-03:** Sorted array JSON comparison for order-independent capability change detection in seed script
- **70-01:** Late-bound executor reference for worker loop DelegationDeps (avoids circular construction)
- **70-01:** Depth stored in both DB column (indexed queries) and JSONB metadata (delegation context)
- **70-01:** task:delegate returns wait_for guidance with task_handshake type and 30s timeout
- **70-03:** Delegation guidance as prompt section (agent-first principle -- behavior via prompts, not executor code)
- **70-03:** Spawn vs delegate heuristic: subAgents list = spawn (internal specialist), directory lookup = delegate (cross-domain)
- [Phase 70]: Worker loop populates delegationDeps for both task:delegate AND task:respond (target agent needs executor.signal())
- [Phase 70]: Orphan case still transitions task to active if accepted (completion signaling delivers results)
- **71-01:** WaitForState.waitType -> waitTypes (always array) for uniform multi-type handling
- **71-01:** Backward compat: signalMatchesPendingWait normalizes old { type } and new { types } formats
- **71-01:** wait_for_task is a separate tool (not a mode of wait_for) for safety-by-design
- **71-01:** Synthetic pendingWait for worker-loop post-execution queued signal matching

### Pending Todos

1. **Fix 4 pre-existing test failures** (code quality)
2. **Run dev-agent container as non-root** (infrastructure)
3. **11 tests skipped pending infrastructure** (testing)

### Blockers/Concerns

- Linear Agent SDK is developer preview -- feature flag (LINEAR_AGENT_SDK_ENABLED) needed for fallback
- Linear OAuth token migration deadline: April 1, 2026 (LSDK-02 must ship before)
- pgvector Docker image swap shipped in 68-01 (pgvector/pgvector:pg15 replaces postgres:15-alpine) -- existing volumes compatible

## Session Continuity

Last session: 2026-02-10
Stopped at: Completed 71-01-PLAN.md
Resume file: None
Next action: Execute 71-02-PLAN.md (callback routing and completion result delivery)

---
*Updated: 2026-02-10 -- Phase 71 plan 01 complete: multi-type wait_for, signal matching, wait_for_task tool*
