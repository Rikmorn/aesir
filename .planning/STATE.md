# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.
**Current focus:** v2.3 Unified Agent Framework — Phase 39 plan 01 complete, plan 02 next

## Current Position

Phase: 39 of 47 (History Manager)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-01 — Completed 39-01-PLAN.md (Phase 1 pruning pipeline)

Progress: [████░░░░░░] ~27% (8/~30 estimated plans)

## Milestone History

| Milestone | Shipped | Phases | Plans |
|-----------|---------|--------|-------|
| v1 MVP | 2026-01-19 | 9 | 34 |
| v2.0 Foundation | 2026-01-25 | 14 | 104 |
| v2.1 Agents That Ship | 2026-01-28 | 5 | 46 |
| v2.2 Agentic Architecture | 2026-01-31 | 9 | 30 |

## Performance Metrics

**Velocity:**
- Total plans completed: 8 (v2.3)
- Average duration: 6m28s
- Total execution time: 51m42s

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 37 | 3/3 | 20m09s | 6m43s |
| 38 | 4/4 | 20m59s | 5m15s |
| 39 | 1/2 | 10m33s | 10m33s |

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
- Copy truncateJsonPayload into event-log.ts rather than shared utility -- avoids cross-module dependency for small helper
- Fire-and-forget subscriber notification via void handler().catch() -- errors must never block append()
- Atomic JSONB merge for artifact extraction using COALESCE + || operator -- simpler than read-merge-write, no race conditions
- ToolContext uses optional DevContainerManager and taskId -- not all agents need containers
- ToolRegistry reports ALL missing refs on resolve failure -- better developer experience than failing on first
- AgentDefinitionYamlSchema version is z.string() -- avoids YAML numeric coercion issues
- Agent definitions store unescaped prompt text in prompt.md -- files contain actual LLM-visible text, not TypeScript encoding
- Sub-agent tokenBudget set to standalone values (100k) -- v2.3 executor overrides with parent shared budget when spawning
- AgentRegistry verifies YAML id matches directory name -- prevents mismatched definitions
- AgentRegistry version mismatch returns cached definition with warning -- file-based registry only stores latest version
- MCP adapter uses create-all-then-find pattern -- preserves v2.2 batch factory compatibility without modifying existing tool files
- spawn_agent placeholder does NOT use createSpawnAgentTool -- Phase 40 replaces with ConversationExecutor-backed implementation
- structuredClone for deep-cloning messages in history manager -- correctness over performance
- Tool tier classification by name prefix rather than configurable map -- simpler, sufficient for v2.3

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
Stopped at: Completed 39-01-PLAN.md (Phase 1 pruning pipeline -- 24 tests, 665 lines)
Resume file: None
Next action: Phase 39 plan 02 (Phase 2 summarization)

---
*Updated: 2026-02-01 — Completed plan 39-01, Phase 1 pruning pipeline*
