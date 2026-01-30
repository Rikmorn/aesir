---
phase: 35-guardrails-cleanup
verified: 2026-01-30T22:30:00Z
status: passed
score: 5/5 success criteria verified
---

# Phase 35: Guardrails & Cleanup Verification Report

**Phase Goal:** Safety guardrails are enforced across all agents and all LangGraph code is removed from the codebase

**Verified:** 2026-01-30T22:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria Verification

#### 1. Sandbox enforcement and merge protection
**Status:** PASS
**Evidence:**

**run_command sandboxing:**
- Tool implementation uses `containerManager.execute(taskId, {...})` (line 55 of `run-command.ts`)
- All commands execute via container manager, no host access
- Tool is bound to specific dev container via `CodebaseToolDeps`

**merge_pull_request protection:**
- Tool definition exists in `github-tools.ts` (lines 203-212) for MCP layer
- Orchestrator toolkit EXCLUDES merge from filter (line 223-229 of `toolkits.ts`):
  ```typescript
  const orchestratorGitHub = allGitHub.filter((t) =>
    [
      "github_create_branch",
      "github_create_commit",
      "github_create_pull_request",
      "github_get_pull_request",
    ].includes(t.name),
  );
  ```
- Comment at line 164 explicitly states: "merge_pull_request is intentionally excluded -- humans review and merge PRs"
- System prompt educates agent about human-only merges (defense-in-depth)

#### 2. Token budget enforcement with cost tracking
**Status:** PASS
**Evidence:**

**Budget enforcement:**
- `isExhausted()` check at line 239 of `run-agent-loop.ts` - hard stop when zero tokens
- `isReserveOnly()` check at line 253 - triggers graceful wrap-up with final LLM call
- Budget deducted after each LLM call via `tokenBudget.deduct(inputTokens, outputTokens)`
- Warning threshold at 20% remaining (WARNING_THRESHOLD_RATIO = 0.2)
- Reserve buffer at 5K tokens (RESERVE_BUFFER = 5_000)

**Cost tracking across task:**
- `getTaskTokenUsage(db, taskId)` aggregates tokens from `agents.execution_traces` table
- Query sums `token_count_input` and `token_count_output` across ALL trace entries
- Returns `{ taskId, totalInputTokens, totalOutputTokens, totalTokens, traceCount }`
- Captures orchestrator + all sub-agent token usage via task_id correlation

**Graceful exhaustion:**
- When reserve-only, adds system message: "[SYSTEM] Token budget nearly exhausted. Provide a brief summary..."
- Returns status "max_tokens" with lastTextOutput preserved
- No exceptions thrown - clean shutdown

#### 3. All @langchain/* dependencies removed, LangGraph code deleted
**Status:** PASS
**Evidence:**

**package.json verification:**
- No `@langchain/anthropic` dependency (removed)
- No `@langchain/core` dependency (removed)
- No `@langchain/langgraph` dependency (removed)
- No `@langchain/langgraph-checkpoint-postgres` dependency (removed)
- Only Anthropic SDK (`@anthropic-ai/sdk: ^0.72.0`) for LLM calls

**Code deletion verification:**
- `code-workflow/` directory: DELETED (no longer exists)
- Graph definitions: DELETED (no StateGraph imports found)
- Node implementations: DELETED (no node directories found)
- State schemas: DELETED (no LangGraph state files found)
- `routeByPhase()`: DELETED (grep found zero actual usages, only comments)
- Phase enums for state machine: DELETED (only Temporal workflow phases remain, which are different)

**LangGraph mentions:**
- Only in comments documenting what was replaced (e.g., "replaces the 13-node LangGraph graph")
- No imports from `@langchain/*` packages
- No `StateGraph`, `Annotation`, `END` imports

#### 4. Temporal activity retry config designed for agentic loops
**Status:** PASS
**Evidence:**

**Orchestrator activities (LLM-heavy):**
- startToCloseTimeout: "45 minutes" (line 112)
- heartbeatTimeout: "5 minutes" (line 113)
- maximumAttempts: 2 (line 115)
- initialInterval: "30 seconds" (line 116)
- backoffCoefficient: 2 (line 117)
- maximumInterval: "2 minutes" (line 118)
- nonRetryableErrorTypes: ["TokenBudgetExhaustedError", "AgentAbortedError"] (lines 119-122)

**Infrastructure activities (fast container ops):**
- startToCloseTimeout: "5 minutes" (line 128)
- maximumAttempts: 3 (line 130)
- initialInterval: "5 seconds" (line 131)
- backoffCoefficient: 2 (line 132)
- maximumInterval: "30 seconds" (line 133)

**Product agent activities:**
- startToCloseTimeout: "5 minutes" (line 79)
- maximumAttempts: 3 (line 81)
- initialInterval: "1 second" (line 82)
- backoffCoefficient: 2 (line 83)

**Design rationale:**
- Orchestrator: Limited retries (2) due to LLM expense, longer timeout (45min) for multi-agent loops
- Infrastructure: More retries (3) for transient Docker/network issues, shorter timeout (5min)
- Heartbeat every 5 minutes prevents premature cancellation during long LLM calls
- Non-retryable errors prevent wasted LLM calls on permanent failures (budget exhausted, user aborted)
- Backoff caps prevent excessive delays (2min max for orchestrator, 30s for infrastructure)

#### 5. PostgresSaver checkpointer removed
**Status:** PASS
**Evidence:**

**No checkpoint imports:**
- Zero files import `@langchain/langgraph-checkpoint-postgres`
- Zero files import `PostgresSaver`
- Grep for "checkpoint" found only one comment reference in product-agent-activity.ts

**Migration exists:**
- File: `packages/platform/src/db/migrations/0004_drop_langgraph_checkpoints.sql`
- Drops `langgraph_checkpoint_writes`, `langgraph_checkpoint_blobs`, `langgraph_checkpoints` tables
- Journal entry confirms migration applied

**Context persistence via context_snapshots:**
- Table `agents.context_snapshots` stores semantic context at activity boundaries
- Written at end of each activity, read at start of next
- Fields: summary, completed_actions, pending_intent, known_issues, project_context, key_files, research_findings, plan
- No LangGraph checkpoint dependency - pure application-level persistence

## Requirements Coverage

All 9 GUAR requirements satisfied:

| Requirement | Status | Evidence |
|-------------|--------|----------|
| GUAR-01 | ✓ SATISFIED | run_command uses DevContainerManager sandbox, no host access |
| GUAR-02 | ✓ SATISFIED | merge_pull_request excluded from all agent toolkits |
| GUAR-03 | ✓ SATISFIED | AgentConfig exports TOKEN_BUDGET_DEFAULT, MAX_ITERATIONS_DEFAULT |
| GUAR-04 | ✓ SATISFIED | Temporal retry configs: 45min/2 retries for orchestrator, 5min/3 for infra |
| GUAR-05 | ✓ SATISFIED | isExhausted() and isReserveOnly() checks before each LLM call |
| GUAR-06 | ✓ SATISFIED | getTaskTokenUsage() aggregates tokens from execution_traces |
| GUAR-07 | ✓ SATISFIED | Zero @langchain/* dependencies in package.json |
| GUAR-08 | ✓ SATISFIED | All LangGraph code deleted: 51 files, code-workflow/ directory gone |
| GUAR-09 | ✓ SATISFIED | PostgresSaver removed, context_snapshots table handles persistence |

## Anti-Patterns Found

None. All code follows established patterns:
- ✓ Token budget checks are comprehensive (exhausted + reserve tiers)
- ✓ Retry configs are appropriate for workload type
- ✓ No dead LangGraph code remains
- ✓ Sandbox enforcement is sound (container manager only)
- ✓ Cost tracking is query-based (appropriate for current scale)

## Summary

**Phase 35 goal ACHIEVED.** All 5 success criteria verified through actual codebase inspection:

1. ✓ **Sandbox and merge protection:** run_command executes in containers only, merge_pull_request excluded from agent toolkits
2. ✓ **Token budget enforcement:** Two-tier checking (exhausted/reserve), graceful wrap-up, cost tracked per task
3. ✓ **LangGraph removal complete:** Zero @langchain dependencies, 51 files deleted, code-workflow gone
4. ✓ **Temporal retry config:** Tuned for agentic loops (45min/2 retries orchestrator, 5min/3 infra, heartbeat, non-retryable errors)
5. ✓ **PostgresSaver removed:** checkpoint tables dropped, context_snapshots handles persistence

Safety guardrails are enforced across all agents and LangGraph is completely removed from the codebase. Ready to proceed to Phase 36 (End-to-End Validation).

---

_Verified: 2026-01-30T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
