# Phase 83: Tree-Level Token Budgets - Research

**Researched:** 2026-02-23
**Domain:** Token budget management across delegation trees, database schema changes, dashboard visualization
**Confidence:** HIGH

## Summary

Phase 83 adds tree-level token budget tracking and enforcement across delegation trees. The existing per-conversation token budget (`TokenBudget` in `token-budget.ts`) is a mutable in-memory counter used only for sub-agent spawning within a single conversation. Tree-level budgets operate at a different layer: they span multiple conversations connected by task delegation (`task:delegate` and `task:delegate_group`), persisted in PostgreSQL, and tracked via columns on the `conversations` table.

The core pattern: root conversations activated by event triggers read `treeBudget` from their `definition.yaml`. On delegation, the parent carves a portion of its remaining subtree budget and passes it to the child conversation. Each conversation tracks its own consumption plus all descendants' consumption. The existing agent loop checks (exhaustion, reserve, warning) in `run-agent-loop.ts` provide the template for tree budget checks -- same checkpoint location, different budget source.

**Primary recommendation:** Add `subtree_allocation` and `subtree_consumed` columns to the `conversations` table. The worker loop reads these at conversation start, creates a tree-budget-aware wrapper, and checks/updates them at each iteration boundary. No global counters, no tree walks at runtime -- each conversation's local state is sufficient.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Budget allocation model
- Hierarchical pre-allocation with release on completion -- each subtree gets a guaranteed slice, not a shared pool
- Parent's own token usage counts against its tree budget from the start
- When delegating, tokens are reserved from the parent's remaining pool immediately
- Release is implicit: tracking consumption (not allocation-minus-releases) means remaining updates naturally when children stop consuming
- `effective_limit = min(definition.tokenBudget, subtreeRemaining)` -- per-conversation cap and subtree allocation are independent ceilings, whichever is lower wins

#### Budget allocation defaults
- `task:delegate` (sequential): child gets all remaining tree budget if no explicit allocation -- natural for chains where parent passes everything down
- `task:delegate_group` (parallel): equal split of remaining across group size -- knowable at delegation time since all tasks created at once
- Over-allocation: cap to remaining with warning in tool response ("Requested 80,000 but 30,000 remaining -- allocated 30,000"). Hard fail if remaining is 0 (no zero-allocation conversations)

#### Budget origin
- `treeBudget` field in definition.yaml, set by the operator -- NOT on task:delegate
- Corrects BUD-01: root conversations start by event trigger via start(), not task:delegate. YAML origin ensures root's own usage is tracked from the start
- Started by event trigger (root) -> treeBudget from definition.yaml activates
- Started by delegation (child) -> inherits parent's allocation, its own treeBudget definition is ignored
- No treeBudget in definition.yaml -> no tree enforcement (BUD-06 backward compatibility)

#### Budget tracking
- Each conversation knows: subtreeAllocation (what parent gave it), subtreeConsumed (own + all descendants' usage)
- subtreeRemaining = subtreeAllocation - subtreeConsumed (computed, not stored as separate field)
- No global counter -- root's allocation IS the tree budget, decomposes naturally through the hierarchy
- task:tree_budget tool computes by reading local state, no tree traversal needed

#### Exhaustion behavior
- Warning at 80% consumed, hardcoded constant -- not configurable per agent/tree
- Warning delivered as injected context message in the agent loop (same checkpoint as exhaustion check, softer action) -- NOT via signal infrastructure
- Warning includes concrete numbers: tokens used, tokens remaining, percentage
- One-time delivery per conversation via warningDelivered flag
- Each conversation checks its own subtree (local check, no walk to root)

#### Hard stop mechanics
- At 100%: current turn completes, then TreeBudgetExhaustedError (non-retryable, same pattern as TokenBudgetExhaustedError)
- No cleanup turn -- the 80% warning IS the cleanup opportunity
- Check in agent loop before each LLM call (same location as per-conversation budget check)
- Parallel overshoot bounded at one turn per active conversation -- acceptable tradeoff vs synchronized kill mechanism
- Waiting conversations discover exhaustion on first iteration after resume
- Failed with reason tree_budget_exhausted (distinct from token_budget_exhausted)

#### Parent notification on child exhaustion
- No new signal type -- child exhaustion flows through existing task settlement
- Parent either sees failure via wait_for resume or discovers its own budget exhaustion on next iteration
- For groups: PAR-05 signal aggregation handles it (all_required wakes on first failure)

#### Agent interaction: context and tools
- Context injection at conversation start: one line with allocation and parent's total ("Tree budget: 80,000 tokens allocated from parent's 300,000 tree budget. Use task:tree_budget to check remaining.")
- task:tree_budget tool for mid-conversation dynamic state -- allocated, consumed, remaining, percentage, descendant breakdown (active count, completed count, descendant consumed)
- Tool scoped to own subtree only -- no sibling/parent visibility. Root naturally sees full tree since its subtree IS the tree
- No tree budget -> no injection, no tool access (zero overhead for BUD-06 backward compat)

#### Budget allocation parameter
- Optional `budgetAllocation` on task:delegate -- absolute token count carved from parent's remaining
- Defaults apply when omitted (all remaining for sequential, equal split for groups)
- Absolute tokens, not percentage -- consistent with tokenBudget, no computation needed
- For delegate_group: one budgetAllocation on the group that splits evenly. Per-task overrides deferred to v3.0

#### Prompt guidance
- No prompt changes for budget management -- system injection + warnings are sufficient
- No "Budget Management" section in prompt.md -- this would be a state machine in natural language (anti-pattern per PROMPT_GUIDE.md)
- Agents naturally adjust from ambient awareness (context injection) and reactive warnings (80% message)

#### Dashboard visualization
- Delegation graph (primary): budget bar on each node showing allocation/consumption with fill, color progression (neutral < 60%, warning 60-80%, critical > 80%, exhausted 100%). Root node shows total tree budget prominently
- Conversation detail (secondary): subtree budget section with own vs descendant split, progress bar, remaining/total. Section absent when no tree budget
- Static on page load, refresh on navigation -- no SSE for budget state (low-frequency changes, threshold events already in SSE timeline)
- Tokens only on graph -- no dollar estimates (cost estimation already in conversation detail via Phase 79)
- Warning/exhaustion events visible in existing event timeline

#### Task status fix (tech debt)
- Add `failed` to taskStatusValues in all three locations (agents schema, agents schema.drizzle, dashboard schema)
- Database migration to allow the value
- Clean up dead refs where code references `failed` status that the schema doesn't officially support

### Claude's Discretion
- Exact schema design for storing subtreeAllocation and subtreeConsumed (new columns vs new table)
- How tree budget aggregation query works (recursive CTE vs denormalized tracking)
- Budget bar component styling within existing design system
- Migration strategy for adding failed status
- Event types for budget warning and exhaustion logging

### Deferred Ideas (OUT OF SCOPE)
- Per-task budget overrides within delegate_group (v3.0 refinement if per-task allocation control needed beyond equal split)
- Tree-level cost summary on root's conversation detail (aggregate dollar amounts across tree)
- Burn rate chart / time-series budget visualization (requires new time-series storage infrastructure)
- Configurable warning threshold per agent (revisit only if 80% proves wrong across the board)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUD-01 | Tree budget allocation -- `treeBudget` field in definition.yaml sets the total token budget for the entire delegation tree when agent is root. Root's own usage counts from start. Children inherit parent's allocation, their own treeBudget is ignored | New `treeBudget` field in AgentDefinitionYamlSchema; `subtree_allocation` and `subtree_consumed` columns on conversations table; worker loop reads definition.treeBudget for root conversations and populates columns at conversation start |
| BUD-02 | Budget propagation -- delegated tasks inherit portion of remaining tree budget. Delegating agent can specify allocation or accept default (equal split for groups, all remaining for sequential) | `budgetAllocation` parameter on `task:delegate` and `task:delegate_group` input schemas; passed through StartConversationParams to conversation row; defaults computed in tool execute() |
| BUD-03 | Budget tracking -- real-time token usage aggregated, queryable via `task:tree_budget` tool | `subtree_consumed` column updated after each LLM call via propagation to parent chain; `task:tree_budget` tool reads local columns + queries child conversation counts |
| BUD-04 | Budget exhaustion signal -- warning at 80%, hard stop at 100% | Tree budget check in agent loop (same location as per-conversation check); `TreeBudgetExhaustedError` class; injected context message for warning; `tree_budget_warning` and `tree_budget_exhausted` event types |
| BUD-05 | Budget visibility in dashboard -- token usage per tree level, per conversation, total. Visual in task tree view | Budget bar component on task-node.tsx; subtree budget section in task-detail-panel.tsx; new columns exposed via dashboard services/tasks.ts query |
| BUD-06 | Backward compatibility -- no tree budget = existing per-conversation behavior | All tree budget logic gated on `subtree_allocation IS NOT NULL`; no treeBudget in definition.yaml means columns stay NULL; all checks skip when allocation is null |
</phase_requirements>

## Standard Stack

### Core
No new external libraries required. This phase uses existing stack:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | existing | Schema definition and query builder | Already used for all DB access |
| Zod | existing | Schema validation for definition.yaml, tool inputs | Already validates all external boundaries |
| @xyflow/react | existing | React Flow for delegation graph | Already renders task delegation tree |
| Tailwind CSS | existing | Dashboard component styling | Already used for all dashboard UI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg (raw SQL) | existing | Migration DDL | For ALTER TABLE ADD COLUMN migration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New columns on conversations | Separate `tree_budgets` table | Separate table adds a JOIN on every conversation claim. Since every conversation potentially has budget data and the worker loop reads it on every claim cycle, columns on conversations are simpler and faster. Recommended: columns |
| Denormalized subtree_consumed | Recursive CTE at read time | CTE walks the tree on every budget check (per-LLM-call frequency). Denormalized column with propagation on write is O(depth) writes vs O(tree_size) reads. Recommended: denormalized |
| New event types | Reuse existing types | Budget events are distinct lifecycle moments (tree_budget_warning, tree_budget_exhausted). New event types are more grep-able and filterable in the dashboard timeline. Recommended: new types |

## Architecture Patterns

### Schema Design: New Columns on conversations Table

**Recommendation:** Add two nullable INTEGER columns to `agents.conversations`:

```sql
ALTER TABLE agents.conversations
  ADD COLUMN subtree_allocation INTEGER,        -- NULL = no tree budget
  ADD COLUMN subtree_consumed   INTEGER DEFAULT 0;
```

Plus a boolean flag for one-time warning delivery:

```sql
ALTER TABLE agents.conversations
  ADD COLUMN tree_budget_warning_delivered BOOLEAN NOT NULL DEFAULT false;
```

**Why columns, not a separate table:**
- The worker loop already reads the full conversation row on every claim (`SELECT ... FOR UPDATE SKIP LOCKED`). Adding 2 integers to the existing row is zero-cost vs adding a JOIN
- The conversations table already has 20+ columns -- two more integers are noise
- NULL semantics give us BUD-06 backward compat for free: `subtree_allocation IS NULL` means "no tree budget"
- The tree budget check runs before every LLM call -- accessing local row data vs querying a separate table matters at that frequency

**Column semantics:**
- `subtree_allocation`: Total tokens allocated to this conversation's subtree by its parent. For root conversations, equals `definition.treeBudget`. NULL when no tree budget applies
- `subtree_consumed`: Own token usage + sum of all descendant subtree_consumed values. Updated after each LLM call (own usage) and on delegation-related events
- `tree_budget_warning_delivered`: Prevents duplicate warning injection. Reset is unnecessary since each conversation sees at most one warning

### Pattern 1: Budget Propagation on Delegation

**What:** When `task:delegate` or `task:delegate_group` creates a child conversation, the parent's remaining tree budget is carved and passed to the child.

**When to use:** Every delegation call when the parent has a tree budget (subtree_allocation IS NOT NULL).

**Flow:**
```
Parent (subtree_allocation=300000, subtree_consumed=50000)
  -> remaining = 300000 - 50000 = 250000
  -> delegate_task(budgetAllocation=100000)
  -> Child created with subtree_allocation=100000, subtree_consumed=0
  -> Parent's subtree_consumed stays at 50000 (NOT 150000)
     (child consumption flows up naturally as child consumes)
```

**Implementation points:**
1. `StartConversationParams` gets new optional field: `subtreeAllocation?: number`
2. `conversation-executor.ts` `start()` method passes it through to the INSERT
3. `delegate-task.ts` reads parent's budget state from DB, computes allocation, passes to `executor.start()`
4. `delegate-group.ts` does the same but splits evenly across group size

### Pattern 2: Consumption Propagation

**What:** After each LLM call, the conversation's `subtree_consumed` increases by (input_tokens + output_tokens). This increase must propagate up to all ancestors.

**When to use:** After every LLM response in the agent loop, when the conversation has a tree budget.

**Implementation options (Claude's Discretion area):**

**Option A: Recursive parent update (RECOMMENDED)**
```sql
-- After each LLM call, update own consumed and propagate to ancestors
WITH RECURSIVE ancestors AS (
  SELECT parent_conversation_id, $tokensUsed AS delta
  FROM agents.conversations WHERE id = $conversationId
  UNION ALL
  SELECT c.parent_conversation_id, a.delta
  FROM agents.conversations c
  JOIN ancestors a ON c.id = a.parent_conversation_id
  WHERE c.subtree_allocation IS NOT NULL
)
UPDATE agents.conversations c
SET subtree_consumed = subtree_consumed + $tokensUsed
FROM ancestors a
WHERE c.id = a.parent_conversation_id OR c.id = $conversationId;
```

Wait -- this has issues. The `parent_conversation_id` column tracks sub-agent parents, NOT delegation parents. For delegation, the link is through the `task_id` -> `tasks.parent_id` chain. Let me reconsider.

**Critical insight: Delegation parentage is NOT tracked via `parent_conversation_id`.**

The `parent_conversation_id` column is for sub-agents (spawn_agent), not for delegation (task:delegate). Delegation relationships are tracked through the tasks table: `tasks.parent_id` links child tasks to parent tasks, and `conversations.task_id` links conversations to tasks.

To propagate consumption up the delegation tree, we need to traverse: `conversation -> task -> parent_task -> conversation (where task_id = parent_task.id)`.

**Revised Option A: Direct parent tracking column (RECOMMENDED)**

Add a new column `delegator_conversation_id` to track the delegating parent conversation directly:

Actually, looking more carefully, the conversation row already has `parent_conversation_id` but this is for sub-agents only. For delegation, the link goes: child conversation's `task_id` -> that task's `parent_id` -> find the conversation with that parent task as `task_id`.

This is expensive to traverse. Better approach:

**Option B: Store delegator_conversation_id on the child conversation at delegation time (RECOMMENDED)**

Currently `delegate-task.ts` calls `executor.start()` without linking back to the delegator's conversation. We should add the delegator's conversation ID to `StartConversationParams` and store it on the child. But wait -- `parent_conversation_id` already exists and is only used for sub-agents.

Looking at the schema: `parent_conversation_id: text("parent_conversation_id")` -- this is already present but set only for sub-agent spawning. For delegation, it is NOT set (delegate-task.ts doesn't pass `parentConversationId` to `executor.start()`).

**RECOMMENDATION: Repurpose parent_conversation_id for delegation too.**

Currently `delegate-task.ts` does NOT set `parentConversationId` when calling `executor.start()`. We should start setting it. This gives us a direct conversation->parent_conversation link for delegation, which is exactly what we need for propagation.

Then propagation becomes:
```sql
-- Update self + walk up parent_conversation_id chain
WITH RECURSIVE ancestors AS (
  SELECT id, parent_conversation_id
  FROM agents.conversations WHERE id = $conversationId
  UNION ALL
  SELECT c.id, c.parent_conversation_id
  FROM agents.conversations c
  JOIN ancestors a ON c.id = a.parent_conversation_id
  WHERE c.subtree_allocation IS NOT NULL
)
UPDATE agents.conversations
SET subtree_consumed = subtree_consumed + $tokensUsed,
    updated_at = NOW()
WHERE id IN (SELECT id FROM ancestors);
```

**Caveat:** Delegation currently doesn't set `parent_conversation_id`. This is a deliberate gap from the Phase 70 implementation. Setting it now creates a unified parent chain for both sub-agents and delegations, which is exactly what tree budget propagation needs. Verify there are no downstream consumers that assume `parent_conversation_id` is sub-agent-only.

**Verification:** `parent_conversation_id` is used in:
- Dashboard `getChildConversations()` query -- shows child conversations in conversation detail. Adding delegation children here is actually **desirable** for visibility.
- Worker loop: not used for execution logic, only passed through.
- No logic that assumes the semantics are "sub-agent only".

**Conclusion:** Setting `parent_conversation_id` from `delegate-task.ts` is safe and beneficial. This unifies the parent chain.

### Pattern 3: Tree Budget Check in Agent Loop

**What:** Before each LLM call, check if the tree budget is exhausted or in warning territory.

**Where:** Same checkpoint as the existing per-conversation budget check in `run-agent-loop.ts` (lines 236-246 for exhaustion, 251-312 for reserve, 461-471 for warning).

**Implementation:** Rather than modifying `run-agent-loop.ts` directly (which is a core runtime shared by all agents), the tree budget check should happen in the **worker loop** wrapper around the agent loop. The worker loop already has the conversation context and DB access.

**Recommended approach:** A `TreeBudgetTracker` object created in the worker loop that:
1. Reads `subtree_allocation` and `subtree_consumed` from the conversation row at claim time
2. Provides `isExhausted()`, `isWarning()`, `getRemaining()` methods using DB-fresh values
3. After each LLM response (via `onResponse` callback), updates `subtree_consumed` in DB with propagation
4. The exhaustion check happens in the `onResponse` callback or as a post-LLM-call check

But wait -- the agent loop is running when we need to interrupt it. The existing `TokenBudget` is checked **inside** `run-agent-loop.ts` before each LLM call. For tree budgets, we need the same checkpoint.

**Better approach:** Extend the existing `TokenBudget` interface or create a parallel `TreeBudget` that plugs into the same checkpoint. The agent loop already checks `tokenBudget?.isExhausted()` before each LLM call. We can:

1. Create a `TreeBudgetTracker` that implements an interface compatible with the agent loop's budget check
2. Wire it into the loop via a new optional parameter or by composing with the existing `tokenBudget`

Actually, looking at the code more carefully, the simplest approach is:

**Add a `treeBudgetCheck` callback to `AgentLoopOptions`** that the loop calls at the same checkpoint as the per-conversation budget. This callback queries the DB for fresh `subtree_consumed`, compares to `subtree_allocation`, and returns exhausted/warning/ok. The worker loop creates this callback with DB access.

OR, more elegantly:

**Use `onResponse` to update consumption and then check.** After each LLM response:
1. `onResponse` fires (already happens)
2. Worker loop's onResponse handler updates `subtree_consumed` in DB (propagation)
3. Worker loop then reads fresh state and if exhausted, aborts the agent loop via `AbortSignal`

But AbortSignal is a blunt instrument -- it doesn't allow a clean wrap-up like the reserve buffer does.

**Final recommendation:** The cleanest approach is to add a `treeBudget` check mechanism that mirrors the existing `tokenBudget` check. Two options:

1. **Compose into existing TokenBudget:** Create the per-conversation `TokenBudget` with `effective_limit = min(definition.tokenBudget, subtreeRemaining)`. The tree budget effectively becomes a lower cap on the existing budget. Propagation happens separately via the onResponse callback.

2. **Separate tree budget check via callback:** Add an `onBudgetCheck` callback that fires before each LLM call (at the same checkpoint). Worker loop provides it.

**RECOMMENDATION: Option 1 (compose into TokenBudget).**

This is elegant because:
- The agent loop code doesn't change at all
- `effective_limit = min(definition.tokenBudget, subtreeRemaining)` naturally enforces both limits
- The existing exhaustion, reserve, and warning checks all work automatically
- The worker loop creates the budget with the lower of the two limits
- Consumption propagation to ancestors happens via `onResponse` callback (already wired)

The only addition to `run-agent-loop.ts` needed: tree budget warning injection as a user message (distinct from per-conversation budget warning). This can be done via the `onBudgetWarning` callback that already exists -- the worker loop provides it.

**Wait -- there's a subtlety.** The tree budget is shared across multiple concurrent conversations. When conversation A consumes 10K tokens, the subtreeRemaining for sibling B decreases. But B's `TokenBudget.remaining` is a local in-memory counter that doesn't know about A's consumption.

This is actually fine per the locked decision: "Parallel overshoot bounded at one turn per active conversation -- acceptable tradeoff vs synchronized kill mechanism." Each conversation reads its tree budget state at claim time and operates on that snapshot. On the next iteration, the `subtree_consumed` is refreshed from DB (the onResponse callback writes to DB after each LLM call).

**Revised recommendation:**

1. At conversation claim time: read `subtree_allocation` and `subtree_consumed` from DB
2. Compute `subtreeRemaining = subtree_allocation - subtree_consumed`
3. Create TokenBudget with `total = min(definition.tokenBudget, subtreeRemaining)` if tree budget exists, else `total = definition.tokenBudget` (existing behavior)
4. After each LLM call (onResponse): propagate consumed tokens to self + ancestors in DB
5. **Before each iteration:** refresh `subtree_consumed` from DB and update the TokenBudget's remaining. This catches sibling consumption.

Step 5 requires a new callback or modification. The simplest: add a `refreshRemaining` method to `TokenBudget` that the loop calls at the top of each iteration. For non-tree-budget conversations, it's a no-op.

Actually, this is getting complicated. Let me reconsider.

**Simplest correct approach:**

Don't try to compose tree budgets into the existing TokenBudget. Instead:
1. Keep the existing per-conversation TokenBudget as-is (only for sub-agent spawning)
2. Add a **separate tree budget check** in the worker loop that wraps the agent loop call
3. The check reads `subtree_consumed` from DB before each agent loop invocation (on resume from signal/pause, the check runs)
4. During the agent loop, consumption propagates via `onResponse` callback
5. The agent loop's existing `onBudgetWarning` callback is reused for tree budget warnings (the worker loop computes tree budget state and fires it)
6. After the agent loop completes each iteration, the worker loop checks tree budget exhaustion

Wait -- the agent loop runs continuously (it's a while loop internally). The worker loop calls `runAgentLoop()` once and it runs until completion/pause/error. We can't "wrap" individual iterations.

**OK, the correct architecture:**

The agent loop has these checkpoints (run-agent-loop.ts, lines 220-246):
- Top of while loop: check abort signal, check tokenBudget.isExhausted(), check tokenBudget.isReserveOnly()
- After LLM response: deduct from tokenBudget, check tokenBudget.isWarning()

These checkpoints use the `TokenBudget` object passed via options. The tree budget needs to participate in these same checkpoints.

**FINAL RECOMMENDATION: Compose a CompositeBudget that checks both per-conversation and tree budget.**

Create a new module `tree-budget.ts` that provides a `TreeBudget` object implementing the same `TokenBudget` interface. The worker loop creates either:
- A plain `TokenBudget` (no tree budget, or no sub-agent spawning)
- A `CompositeBudget` that wraps both the per-conversation and tree budget checks

The `CompositeBudget` checks: `isExhausted()` = either budget exhausted; `isWarning()` = either budget in warning; `deduct()` = deducts from per-conversation AND propagates to tree.

The tree budget part of `CompositeBudget` holds a reference to DB and conversation ID, and:
- `isExhausted()`: reads `subtree_consumed` from a local cached value (updated after each deduct)
- `deduct()`: increments local cache AND fires async DB propagation
- `isWarning()`: checks local cache against 80% threshold

The local cache is populated at construction time from the DB and updated locally on each deduct. This avoids a DB read per iteration while still being accurate for this conversation's own consumption. Sibling consumption is "discovered" only on resume (acceptable per locked decision).

### Pattern 4: Context Injection at Conversation Start

**What:** When a conversation has a tree budget, inject a one-line context message.

**Where:** Worker loop, when building the initial/resumed message.

**Format (from CONTEXT.md):** "Tree budget: 80,000 tokens allocated from parent's 300,000 tree budget. Use task:tree_budget to check remaining."

**Implementation:** In the worker loop's `executeConversation()`, after loading the conversation row, check `subtree_allocation`. If non-null, prepend the context line to the system prompt or initial message. The existing `buildTaskContextBlock()` provides the pattern for context injection.

### Pattern 5: task:tree_budget Tool

**What:** A new tool that returns the current tree budget state for the agent's subtree.

**Response shape:**
```json
{
  "allocated": 80000,
  "consumed": 45000,
  "remaining": 35000,
  "percentUsed": 56,
  "descendants": {
    "active": 2,
    "completed": 1,
    "totalConsumed": 30000
  }
}
```

**Implementation:** Register as `task:tree_budget` in tool-factories.ts. The tool reads:
1. Own conversation's `subtree_allocation` and `subtree_consumed` from DB
2. Descendant stats via a query on conversations where `parent_conversation_id` is in the subtree

For descendant breakdown, a simple query:
```sql
SELECT
  COUNT(*) FILTER (WHERE status IN ('running', 'queued', 'waiting')) as active,
  COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'cancelled')) as completed,
  COALESCE(SUM(subtree_consumed), 0) as total_consumed
FROM agents.conversations
WHERE parent_conversation_id = $conversationId
  AND subtree_allocation IS NOT NULL;
```

This only counts direct children, not deep descendants. For the agent's purposes, this is sufficient -- the `subtree_consumed` on each child already includes its own descendants.

### Anti-Patterns to Avoid

- **Global tree counter table:** A single row tracking the whole tree's budget creates contention. Each conversation's local columns are sufficient.
- **Synchronous budget refresh from DB on every iteration:** Too expensive. Use local cache with async propagation.
- **Modifying run-agent-loop.ts core loop logic:** Keep the agent loop generic. Tree budget awareness lives in the worker loop and budget objects.
- **Signal-based warnings:** The CONTEXT.md explicitly rejects using signal infrastructure for budget warnings. Use injected context messages instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Budget bar visualization | Custom SVG bar chart | Tailwind utility classes with percentage-width divs | The budget bar is a simple fill bar. A percentage-width div with color transitions (neutral/warning/critical) is 5 lines of Tailwind. No charting library needed |
| Tree traversal for propagation | Application-level recursive parent walk | PostgreSQL recursive CTE | The DB handles recursive traversal atomically. Application-level walks would need multiple round trips and have race conditions |
| Budget state caching | Custom cache with TTL | Local variable updated on deduct | The budget state only needs to be fresh for the current conversation's own deductions. Sibling consumption staleness is acceptable per locked decision |

**Key insight:** The tree budget is fundamentally a distributed counter problem, but the locked decision to accept "one turn per active conversation" overshoot simplifies it enormously. No distributed coordination needed -- just local tracking with periodic DB writes.

## Common Pitfalls

### Pitfall 1: parent_conversation_id Not Set for Delegations
**What goes wrong:** Consumption propagation walks `parent_conversation_id` chain, but delegation doesn't set it. Budget consumption by children never reaches the root.
**Why it happens:** `delegate-task.ts` calls `executor.start()` without `parentConversationId` because delegation was designed independently of sub-agent spawning.
**How to avoid:** Set `parentConversationId` in the delegate-task.ts and delegate-group.ts `executor.start()` calls. Verify no downstream logic breaks (dashboard child queries, etc.).
**Warning signs:** Root conversation's `subtree_consumed` never increases beyond its own direct consumption.

### Pitfall 2: Race Condition on subtree_consumed Updates
**What goes wrong:** Two sibling conversations both read parent's `subtree_consumed=50000`, both add their 10000, both write `subtree_consumed=60000` instead of `70000`.
**Why it happens:** Read-modify-write without locking on the parent row.
**How to avoid:** Use `SET subtree_consumed = subtree_consumed + $delta` (atomic increment) rather than `SET subtree_consumed = $absoluteValue`. The recursive CTE approach handles this naturally.
**Warning signs:** Budget remaining doesn't decrease as fast as expected.

### Pitfall 3: taskStatusValues Missing "failed"
**What goes wrong:** The group service's `getGroupState()` switch statement has no case for "failed" tasks. The `evaluatePolicy()` function counts `state.failed` but the status is never actually set in the DB because the schema doesn't allow it.
**Why it happens:** Tech debt -- `failed` was intended but never added to the enum. Code references it as if it exists.
**How to avoid:** This phase explicitly fixes this. Add "failed" to all three `taskStatusValues` arrays. Add a migration. Update the VALID_TRANSITIONS map. Check `getGroupState()` switch handles it.
**Warning signs:** `task-signal-dispatcher.test.ts:166` comment "DB has no 'failed' -- cancelled is the terminal non-success" documents the workaround.

### Pitfall 4: Tree Budget Check Creates Unnecessary DB Load
**What goes wrong:** Checking tree budget state on every LLM call iteration creates N DB reads per conversation execution (where N = number of LLM calls).
**Why it happens:** Naive implementation reads DB on every check.
**How to avoid:** Cache budget state locally at claim time. Update locally on own deduction. Only read DB fresh on resume (where sibling consumption may have changed). The `deduct()` method increments a local counter and fires async DB write.
**Warning signs:** High DB connection usage, slow agent loop iterations.

### Pitfall 5: Budget Warning Injected as Regular User Message
**What goes wrong:** The warning message triggers a tool-use response from the agent (agent thinks a user is talking to it), adding unnecessary token consumption.
**Why it happens:** Injecting into conversation messages looks like user input.
**How to avoid:** Use `[SYSTEM]` prefix (same pattern as the existing reserve-only wrap-up injection in `run-agent-loop.ts` line 254). The agent recognizes this as system-level, not user input.
**Warning signs:** Agent responds to the warning message with "I understand you want me to..." instead of adjusting behavior.

### Pitfall 6: Schema Migration for "failed" Task Status -- CHECK Constraint EXISTS
**What goes wrong:** Inserting `status = 'failed'` or `status = 'counter_proposed'` into the tasks table fails with a PostgreSQL CHECK constraint violation.
**Why it happens:** Migration `0005_add_task_tables.sql` line 28 creates `CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled'))`. Phase 80 added `counter_proposed` to the Drizzle schema but never updated the SQL constraint. This means the DB has been silently rejecting `counter_proposed` writes (or the constraint was manually dropped).
**How to avoid:** The Phase 83 migration MUST: (1) DROP the existing CHECK constraint on `agents.tasks.status`, (2) CREATE a new CHECK constraint including `'created', 'counter_proposed', 'active', 'paused', 'completed', 'failed', 'cancelled'`. Use `ALTER TABLE agents.tasks DROP CONSTRAINT IF EXISTS tasks_status_check; ALTER TABLE agents.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (...))`.
**Warning signs:** INSERT with status='failed' or 'counter_proposed' fails with "new row violates check constraint".

## Code Examples

### New Columns Migration (0022_add_tree_budget.sql)

```sql
-- Migration: Add tree-level token budget tracking
-- Phase 83: Tree-Level Token Budgets

-- Tree budget columns on conversations
ALTER TABLE agents.conversations
  ADD COLUMN IF NOT EXISTS subtree_allocation INTEGER,
  ADD COLUMN IF NOT EXISTS subtree_consumed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tree_budget_warning_delivered BOOLEAN NOT NULL DEFAULT false;

-- Index for descendant queries (budget propagation and tree_budget tool)
CREATE INDEX IF NOT EXISTS idx_conversations_parent_budget
  ON agents.conversations (parent_conversation_id)
  WHERE subtree_allocation IS NOT NULL;

-- Fix tasks.status CHECK constraint (tech debt)
-- Original constraint from 0005: CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled'))
-- Phase 80 added 'counter_proposed' to Drizzle schema but never updated the SQL constraint
-- Phase 83 adds 'failed'
-- Drop old constraint and recreate with all valid statuses
ALTER TABLE agents.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE agents.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('created', 'counter_proposed', 'active', 'paused', 'completed', 'failed', 'cancelled'));
```

### Consumption Propagation SQL

```sql
-- Atomic increment of subtree_consumed up the delegation chain
-- Called after each LLM response with $delta = input_tokens + output_tokens
WITH RECURSIVE ancestor_chain AS (
  -- Start with the current conversation
  SELECT id, parent_conversation_id
  FROM agents.conversations
  WHERE id = $conversationId AND subtree_allocation IS NOT NULL

  UNION ALL

  -- Walk up parent chain
  SELECT c.id, c.parent_conversation_id
  FROM agents.conversations c
  INNER JOIN ancestor_chain ac ON c.id = ac.parent_conversation_id
  WHERE c.subtree_allocation IS NOT NULL
)
UPDATE agents.conversations
SET subtree_consumed = subtree_consumed + $delta,
    updated_at = NOW()
WHERE id IN (SELECT id FROM ancestor_chain);
```

### TreeBudget Interface (tree-budget.ts)

```typescript
/**
 * Tree-level budget tracker wrapping per-conversation budget state.
 * Created by the worker loop when conversation has subtree_allocation.
 * Implements the same check interface as TokenBudget for composability.
 */
export interface TreeBudgetState {
  /** Total allocation for this subtree */
  readonly allocation: number;
  /** Consumed tokens (own + descendants), cached locally */
  consumed: number;
  /** Whether 80% warning has been delivered */
  warningDelivered: boolean;

  /** Remaining = allocation - consumed */
  remaining(): number;
  /** Is the tree budget exhausted? */
  isExhausted(): boolean;
  /** Is the tree budget in warning territory (>= 80% consumed)? */
  isWarning(): boolean;
  /** Record token consumption (local cache + async DB propagation) */
  recordConsumption(tokens: number): void;
}

export const TREE_BUDGET_WARNING_THRESHOLD = 0.8;

export function createTreeBudgetState(
  allocation: number,
  currentConsumed: number,
  db: AgentsDb,
  conversationId: string,
  logger: PinoLogger,
): TreeBudgetState {
  return {
    allocation,
    consumed: currentConsumed,
    warningDelivered: false,

    remaining() {
      return Math.max(0, this.allocation - this.consumed);
    },

    isExhausted() {
      return this.consumed >= this.allocation;
    },

    isWarning() {
      return this.consumed >= this.allocation * TREE_BUDGET_WARNING_THRESHOLD;
    },

    recordConsumption(tokens: number) {
      this.consumed += tokens;
      // Fire-and-forget DB propagation
      void propagateConsumption(db, conversationId, tokens, logger);
    },
  };
}
```

### Budget Bar Component Pattern (budget-bar.tsx)

```tsx
/**
 * Budget consumption bar for delegation graph nodes.
 * Color progression: neutral < 60%, warning 60-80%, critical > 80%, exhausted 100%
 */
function BudgetBar({ allocated, consumed }: { allocated: number; consumed: number }) {
  const pct = Math.min(100, Math.round((consumed / allocated) * 100));

  const barColor =
    pct >= 100 ? "bg-red-500" :
    pct >= 80  ? "bg-red-400" :
    pct >= 60  ? "bg-amber-400" :
                 "bg-emerald-400";

  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", barColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

### AgentDefinitionYamlSchema Extension

```typescript
// In types.ts -- add treeBudget to the schema
export const AgentDefinitionYamlSchema = z.object({
  // ... existing fields ...
  tokenBudget: z.number().int().min(0),
  /** Tree-level token budget for the entire delegation tree (optional) */
  treeBudget: z.number().int().positive().optional(),
  // ... rest of schema ...
});
```

### task:delegate Input Schema Extension

```typescript
const DelegateTaskInputSchema = z.object({
  targetEntityId: z.string().min(1),
  description: z.string().min(1),
  parentTaskId: z.string().optional(),
  materialization: MaterializationConfigSchema.optional(),
  /** Tokens to allocate from parent's remaining tree budget. Omit for default (all remaining). */
  budgetAllocation: z.number().int().positive().optional(),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TokenBudget only for sub-agents (spawn_agent) | TokenBudget for sub-agents, NEW TreeBudget for delegation trees | Phase 83 | Prevents runaway costs from parallel/deep delegation chains |
| taskStatusValues missing "failed" | taskStatusValues includes "failed" | Phase 83 | Fixes tech debt where code references status the schema doesn't support |
| parent_conversation_id only for sub-agents | parent_conversation_id for both sub-agents AND delegations | Phase 83 | Unifies parent chain for budget propagation and dashboard child queries |

## Open Questions

1. **CHECK constraint on tasks.status CONFIRMED**
   - What we know: Migration `0005_add_task_tables.sql` line 28 creates `CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled'))`. No subsequent migration updated this constraint (not even Phase 80 which added `counter_proposed` to the Drizzle schema). This means the DB currently rejects BOTH `failed` AND `counter_proposed` at the SQL level.
   - What's unclear: Whether `counter_proposed` is actually being written to the DB (it may be silently failing or the CHECK was dropped manually). Need to verify.
   - Recommendation: The migration must DROP the old CHECK constraint and CREATE a new one including both `counter_proposed` and `failed`. This fixes both the existing Phase 80 gap and the new Phase 83 requirement.

2. **Parent conversation ID for sub-agents vs delegations**
   - What we know: Currently `parent_conversation_id` is set only for sub-agents. Dashboard queries use it for child conversation display.
   - What's unclear: Whether adding delegation parents to the same column causes confusion in the dashboard (mixing sub-agent children with delegation children in the same list)
   - Recommendation: This is likely fine -- both are "child conversations" from the dashboard's perspective. The task tree view already shows delegation relationships separately.

3. **Async propagation timing**
   - What we know: `recordConsumption()` fires a fire-and-forget DB update. If the process crashes before the write lands, the parent's `subtree_consumed` is slightly stale.
   - What's unclear: Whether this staleness causes budget overruns in crash-recovery scenarios
   - Recommendation: Acceptable. The overshoot is bounded by one conversation's single-iteration token consumption (~20K tokens worst case). The system already handles crash recovery for other conversation state.

## Sources

### Primary (HIGH confidence)
- Codebase: `packages/agents/src/shared/agent-loop/token-budget.ts` -- existing TokenBudget interface and implementation
- Codebase: `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- budget check locations (lines 236-246, 251-312, 461-471)
- Codebase: `packages/agents/src/framework/worker-loop.ts` -- conversation execution flow, token budget creation (line 1277-1279)
- Codebase: `packages/agents/src/shared/tools/task/delegate-task.ts` -- delegation flow and executor.start() call
- Codebase: `packages/agents/src/shared/tools/task/delegate-group.ts` -- parallel delegation flow
- Codebase: `packages/agents/src/shared/db/schema.ts` -- conversations table schema, taskStatusValues
- Codebase: `packages/agents/src/shared/db/schema.drizzle.ts` -- drizzle-kit migration tracking schema
- Codebase: `packages/dashboard/src/lib/schema.ts` -- dashboard taskStatusValues
- Codebase: `packages/agents/src/framework/types.ts` -- AgentDefinitionYamlSchema, StartConversationParams, ToolContext
- Codebase: `packages/dashboard/src/components/tasks/task-node.tsx` -- existing delegation graph node component
- Codebase: `packages/dashboard/src/components/tasks/delegation-graph.tsx` -- React Flow graph container
- Codebase: `packages/dashboard/src/components/tasks/task-detail-panel.tsx` -- task detail drawer
- Codebase: `packages/dashboard/src/services/tasks.ts` -- task tree data access layer
- Codebase: `.interface-design/system.md` -- dashboard design system

### Secondary (MEDIUM confidence)
- Spec: `.planning/specs/2.9-platform-completion.md` -- BUD-01 through BUD-06 requirement definitions
- Context: `.planning/phases/83-tree-level-token-budgets/83-CONTEXT.md` -- user decisions
- Architecture: `.planning/research/ARCHITECTURE.md` -- tree budget architecture notes

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH -- no new libraries, all existing patterns
- Architecture (schema design): HIGH -- columns on conversations table with atomic increment propagation is well-understood PostgreSQL pattern
- Architecture (agent loop integration): HIGH -- composing tree budget into existing checkpoint mechanism is clean
- Architecture (dashboard): HIGH -- budget bar is a simple Tailwind component on existing graph nodes
- Pitfalls: HIGH -- verified each against actual codebase state (parent_conversation_id gap confirmed, taskStatusValues gap confirmed)

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable domain, no external dependencies)
