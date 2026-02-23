---
phase: 83-tree-level-token-budgets
verified: 2026-02-23T02:30:00Z
status: passed
score: 16/16 must-haves verified
re_verification: false
---

# Phase 83: Tree-Level Token Budgets Verification Report

**Phase Goal:** Token spending across an entire delegation tree is tracked and enforced as a single budget, preventing runaway costs from parallel or deep delegation chains
**Verified:** 2026-02-23T02:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Root conversations can activate a tree budget from definition.yaml `treeBudget` field | VERIFIED | `worker-loop.ts:1305-1316` initializes from `definition.treeBudget` when root (no parent); schema accepts optional `treeBudget` in `types.ts:306` |
| 2 | Child conversations inherit a portion of the parent's remaining tree budget at delegation time | VERIFIED | `delegate-task.ts:274-276` passes `parentConversationId` and `subtreeAllocation`; `delegate-group.ts:374-376` does equal-split |
| 3 | Token consumption is tracked in real-time and propagated up the delegation chain | VERIFIED | `tree-budget.ts:59-90` recursive CTE with atomic `subtree_consumed + delta` increment; `worker-loop.ts:1816-1820` records per-LLM-response |
| 4 | Warning is injected as a [SYSTEM] message when 80% of tree budget is consumed | VERIFIED | `worker-loop.ts:1825-1872` checks `isWarning() && !warningDelivered`, returns [SYSTEM] string from `onResponse`; `run-agent-loop.ts:489-494` injects as user message |
| 5 | Hard budget exhaustion stops the conversation (non-retryable) after current turn completes | VERIFIED | `worker-loop.ts:1901-1914` throws `TreeBudgetExhaustedError` after `runAgentLoop()` returns; `worker-loop.ts:2555-2590` catches as non-retryable, sets status=failed |
| 6 | Agents can query their subtree budget state via `task:tree_budget` tool | VERIFIED | `tree-budget-tool.ts` returns allocated/consumed/remaining/percentUsed/descendants; registered in `tool-factories.ts:396` |
| 7 | Budget consumption is visible in the dashboard delegation graph | VERIFIED | `budget-bar.tsx` with color progression; `task-node.tsx:117-120` conditionally renders BudgetBar; `tasks.ts:119-153` queries subtree columns |
| 8 | Conversations without a tree budget continue working unchanged (zero overhead) | VERIFIED | All tree budget paths gated on `treeBudgetState != null` and `subtree_allocation IS NOT NULL` |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/shared/db/migrations/0022_add_tree_budget.sql` | Migration adding tree budget columns + task status constraint fix | VERIFIED | Adds `subtree_allocation`, `subtree_consumed`, `tree_budget_warning_delivered` columns; fixes tasks CHECK constraint to include `counter_proposed` and `failed` |
| `packages/agents/src/shared/db/schema.ts` | Drizzle schema with tree budget columns and `failed` in taskStatusValues | VERIFIED | All 3 columns present (lines 123-125); `failed` in taskStatusValues (line 65) |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Drizzle-kit tracking schema with `counter_proposed` and `failed` in taskStatusValues | VERIFIED | Both values present (lines 67-76) |
| `packages/dashboard/src/lib/schema.ts` | Dashboard schema with tree budget columns and `failed` in taskStatusValues | VERIFIED | Columns at lines 53-55; `failed` at line 33; event types `tree_budget.warning`/`tree_budget.exhausted` at lines 87-88 |
| `packages/agents/src/framework/types.ts` | `treeBudget` in AgentDefinitionYamlSchema, `subtreeAllocation` in StartConversationParams | VERIFIED | `treeBudget` at line 306; `subtreeAllocation` at line 696 |
| `packages/agents/src/shared/agent-loop/errors.ts` | `TreeBudgetExhaustedError` class | VERIFIED | Extends `AgentLoopError` with `max_tokens` status (non-retryable), lines 86-95 |
| `packages/agents/src/framework/conversation-executor.ts` | `subtreeAllocation` passed to DB INSERT | VERIFIED | Both INSERT paths pass `subtree_allocation: params.subtreeAllocation ?? null` (lines 275, 328) |
| `packages/agents/src/shared/agent-loop/tree-budget.ts` | `TreeBudgetState` interface and factory, `propagateConsumption` recursive CTE | VERIFIED | Full implementation: interface, factory, recursive CTE propagation, `TREE_BUDGET_WARNING_THRESHOLD = 0.8` |
| `packages/agents/src/shared/tools/task/delegate-task.ts` | Budget allocation carving and `parentConversationId` on executor.start() | VERIFIED | `parentConversationId: ctx.correlationId` at line 274; `subtreeAllocation` at line 276 |
| `packages/agents/src/shared/tools/task/delegate-group.ts` | Equal-split budget allocation for parallel groups | VERIFIED | `parentConversationId: ctx.correlationId` at line 374; `subtreeAllocation: perTaskAllocation` at line 376 |
| `packages/dashboard/src/components/tasks/budget-bar.tsx` | Reusable budget consumption bar with color progression | VERIFIED | Full implementation: emerald < 60%, amber 60-80%, red-400 > 80%, red-500 = 100% |
| `packages/dashboard/src/components/tasks/task-node.tsx` | Task node with conditional BudgetBar rendering | VERIFIED | Imports `BudgetBar` at line 17; conditional render at lines 117-120 |
| `packages/dashboard/src/components/tasks/task-detail-panel.tsx` | Subtree budget section in conversation detail drawer | VERIFIED | Subtree Budget section at lines 167-208 with BudgetBar and 4-metric grid |
| `packages/dashboard/src/services/tasks.ts` | `getTaskTree` query extended with budget columns | VERIFIED | `subtree_allocation` and `subtree_consumed` in SELECT (lines 119-120); mapped at lines 150-153 |
| `packages/agents/src/framework/worker-loop.ts` | Tree budget lifecycle (6 stages) | VERIFIED | All 6 stages confirmed: init (1284-1323), resume refresh (1327-1333), composition (1339-1345), propagation (1816-1820), warning (1825-1872), exhaustion (1901-1914) |
| `packages/agents/src/shared/agent-loop/run-agent-loop.ts` | Checks `onResponse` return value and injects [SYSTEM] message | VERIFIED | Lines 489-494 check return value and push as user message |
| `packages/agents/src/shared/agent-loop/types.ts` | `onResponse` type allows `string \| undefined` return | VERIFIED | Line 176: `onResponse?: (response: LLMResponse) => string \| undefined` |
| `packages/agents/src/shared/tools/task/tree-budget-tool.ts` | `task:tree_budget` tool factory | VERIFIED | Full implementation returning allocated/consumed/remaining/percentUsed/descendants |
| `packages/agents/src/shared/tools/task/index.ts` | Barrel export for `createTreeBudgetTool` | VERIFIED | Line 24: `export { createTreeBudgetTool } from "./tree-budget-tool.js"` |
| `packages/agents/src/framework/tool-factories.ts` | `tree_budget` registered in task namespace | VERIFIED | Line 396: `registry.register("task:tree_budget", (ctx) => createTreeBudgetTool(ctx))` |
| `packages/agents/definitions/dev-agent/definition.yaml` | `task:tree_budget` in tools list | VERIFIED | Line 27 |
| `packages/agents/definitions/product-agent/definition.yaml` | `task:tree_budget` in tools list | VERIFIED | Line 21 |
| `packages/agents/definitions/qa-agent/definition.yaml` | `task:tree_budget` in tools list | VERIFIED | Line 20 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/agents/src/shared/db/schema.ts` | `migrations/0022_add_tree_budget.sql` | Drizzle column definitions match migration SQL | WIRED | Both define `subtree_allocation INTEGER`, `subtree_consumed INTEGER NOT NULL DEFAULT 0`, `tree_budget_warning_delivered BOOLEAN NOT NULL DEFAULT false` |
| `packages/agents/src/framework/types.ts` | `packages/agents/src/shared/db/schema.ts` | `StartConversationParams.subtreeAllocation` maps to `conversations.subtree_allocation` | WIRED | `subtreeAllocation?: number` in params; `subtree_allocation: params.subtreeAllocation ?? null` in executor INSERT |
| `packages/agents/src/shared/tools/task/delegate-task.ts` | `packages/agents/src/framework/conversation-executor.ts` | `executor.start()` with `parentConversationId` and `subtreeAllocation` | WIRED | Lines 274-276 pass both fields |
| `packages/agents/src/shared/agent-loop/tree-budget.ts` | `packages/agents/src/shared/db/schema.ts` | SQL UPDATE on `conversations.subtree_consumed + delta` | WIRED | Line 78: `SET subtree_consumed = subtree_consumed + ${delta}` — atomic increment confirmed |
| `packages/agents/src/framework/worker-loop.ts` | `packages/agents/src/shared/agent-loop/tree-budget.ts` | Creates `TreeBudgetState` and checks it at every lifecycle stage | WIRED | `createTreeBudgetState` imported and called at lines 1284-1323; state checked at 6 points |
| `packages/agents/src/framework/worker-loop.ts` | `packages/agents/src/shared/agent-loop/run-agent-loop.ts` | `onResponse` callback returns [SYSTEM] string, `run-agent-loop` injects as user message | WIRED | `worker-loop.ts:1872` returns string; `run-agent-loop.ts:489-494` injects it |
| `packages/agents/src/framework/worker-loop.ts` | `packages/agents/src/shared/agent-loop/errors.ts` | Throws `TreeBudgetExhaustedError` on budget exhaustion | WIRED | Import at line 22; throw at line 1911 |
| `packages/agents/src/shared/tools/task/tree-budget-tool.ts` | `packages/agents/src/shared/db/schema.ts` | Queries `conversations` via `ctx.delegationDeps.db` for budget stats | WIRED | Lines 56-63 query `subtree_allocation` and `subtree_consumed` from conversations |
| `packages/dashboard/src/components/tasks/task-node.tsx` | `packages/dashboard/src/components/tasks/budget-bar.tsx` | Import and render `BudgetBar` when budget data exists | WIRED | Import at line 17; conditional render at lines 117-120 |
| `packages/dashboard/src/services/tasks.ts` | `packages/dashboard/src/lib/schema.ts` | SQL query selects `subtree_allocation` and `subtree_consumed` from conversations join | WIRED | Lines 119-120 in SQL SELECT; schema columns at lines 53-54 |
| `packages/dashboard/src/components/tasks/graph-utils.ts` | `packages/dashboard/src/components/tasks/task-node.tsx` | Budget fields passed through graph transformation | WIRED | `graph-utils.ts:300-301` passes `subtreeAllocation` and `subtreeConsumed` to node data |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| BUD-01 | 83-01, 83-02, 83-04 | Tree budget allocation -- root task sets a total token budget via `treeBudget` in definition.yaml | SATISFIED | `AgentDefinitionYamlSchema.treeBudget` optional field; worker-loop activates from definition on root conversations; tool support via `task:tree_budget` |
| BUD-02 | 83-02 | Budget propagation -- delegated tasks inherit a portion of the remaining tree budget | SATISFIED | `delegate-task.ts` queries parent remaining, carves allocation; `delegate-group.ts` equal-splits; both pass `subtreeAllocation` to `executor.start()` |
| BUD-03 | 83-02, 83-04 | Budget tracking -- real-time token usage aggregated across all conversations in the tree, queryable via `task:tree_budget` | SATISFIED | Recursive CTE propagation in `tree-budget.ts`; `task:tree_budget` tool returns live stats; `worker-loop.ts` records per-response consumption |
| BUD-04 | 83-04 | Budget exhaustion signal -- warning at 80%, hard exhaustion stops all conversations | SATISFIED | 80% warning injected as [SYSTEM] message exactly once per conversation; 100% throws `TreeBudgetExhaustedError` (non-retryable), sets status=failed |
| BUD-05 | 83-03 | Budget visibility in dashboard -- visual representation in task tree view | SATISFIED | `BudgetBar` component with color-coded fill bars on delegation graph nodes; detail panel with 4-metric grid |
| BUD-06 | 83-01, 83-02, 83-03, 83-04 | Backward compatibility -- conversations without tree budget use per-conversation budgets | SATISFIED | All tree budget paths gated on `subtree_allocation IS NOT NULL` or `treeBudgetState != null`; nullable column pattern throughout |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned key modified files for TODO/FIXME, placeholder returns, empty implementations, and console.log-only stubs. None found.

### Human Verification Required

#### 1. Tree Budget Activation End-to-End

**Test:** Set `treeBudget: 100000` in `dev-agent/definition.yaml`, trigger a dev-agent conversation via a Linear event, then query the database to confirm `subtree_allocation = 100000` on that conversation's row.
**Expected:** The root conversation has `subtree_allocation` set; delegated child conversations have carved allocations; `task:tree_budget` returns correct numbers.
**Why human:** Requires running Docker services, a real Linear webhook, and DB inspection.

#### 2. Warning [SYSTEM] Message Delivery

**Test:** With a tight tree budget, trigger consumption past the 80% threshold within a single conversation turn. Inspect the agent's message history to confirm a `[SYSTEM]` user message was injected.
**Expected:** The warning appears exactly once in the conversation history with token counts and percentage.
**Why human:** Requires runtime observation of in-memory message history across LLM calls.

#### 3. Dashboard Budget Bar Rendering

**Test:** With an active tree budget conversation, open the delegation graph in the dashboard. Verify budget bars appear on graph nodes with correct colors.
**Expected:** Nodes with budget data show colored fill bars; nodes without budget data show no bar; color progression matches emerald/amber/red thresholds.
**Why human:** Visual UI rendering requires browser inspection.

#### 4. Propagation Correctness Under Parallel Delegation

**Test:** Delegate two tasks in parallel via `delegate_group`, let each child consume tokens, then query the root conversation's `subtree_consumed` — it should be the sum of both children's consumption.
**Expected:** Atomic recursive CTE correctly aggregates child consumption up to the root without race conditions or double-counting.
**Why human:** Requires concurrent execution and DB inspection after settlement.

## Summary

Phase 83 goal is achieved. All 6 requirements (BUD-01 through BUD-06) are satisfied by substantive, wired implementations:

- **Schema foundation (Plan 01):** Migration 0022 adds tree budget columns to conversations and fixes the task status CHECK constraint. All three schema locations (agents, drizzle-kit, dashboard) are updated. `TreeBudgetExhaustedError` exists as a non-retryable error. `StartConversationParams` and `AgentDefinitionYamlSchema` accept the new fields.

- **Tracking and delegation (Plan 02):** `TreeBudgetState` module provides local-cache tracking with async recursive CTE propagation. `delegate_task` and `delegate_group` correctly carve allocations from the parent's remaining budget and pass `parentConversationId` to link the delegation chain.

- **Dashboard visualization (Plan 03):** `BudgetBar` component is substantive (not a stub), wired into task nodes and the detail panel. The `getTaskTree` SQL query selects budget columns and maps them to `TaskTreeNode`. The graph-utils transformation passes budget fields through to node data.

- **Runtime enforcement (Plan 04):** Worker loop has all 6 lifecycle stages. The `onResponse` return-value injection mechanism is a clean extension to `run-agent-loop.ts`. `task:tree_budget` tool is registered and added to all three delegating agents. `TreeBudgetExhaustedError` is caught as non-retryable and properly fails the conversation.

The one notable observation: `treeBudget` is not set in any production agent definition.yaml (dev-agent, product-agent, qa-agent), meaning tree budgets will not activate automatically in production until an operator explicitly sets the field. This is correct per the spec (optional field, BUD-06 backward compatibility), but it means the end-to-end feature is infrastructure-ready without being operationally activated.

Typecheck passes cleanly across all 9 packages with zero errors.

---

_Verified: 2026-02-23T02:30:00Z_
_Verifier: Claude (gsd-verifier)_
