# Phase 83: Tree-Level Token Budgets - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Token spending across entire delegation trees is tracked and enforced as a single budget. A root conversation declares a tree budget in its definition.yaml, and that budget distributes hierarchically to descendants via delegation. The system warns at 80% consumption, hard-stops at 100%, and the dashboard visualizes budget state on existing surfaces. Also includes adding `failed` to `taskStatusValues` (deferred tech debt that fits naturally here since this phase touches task lifecycle via budget exhaustion).

</domain>

<decisions>
## Implementation Decisions

### Budget allocation model
- Hierarchical pre-allocation with release on completion — each subtree gets a guaranteed slice, not a shared pool
- Parent's own token usage counts against its tree budget from the start
- When delegating, tokens are reserved from the parent's remaining pool immediately
- Release is implicit: tracking consumption (not allocation-minus-releases) means remaining updates naturally when children stop consuming
- `effective_limit = min(definition.tokenBudget, subtreeRemaining)` — per-conversation cap and subtree allocation are independent ceilings, whichever is lower wins

### Budget allocation defaults
- `task:delegate` (sequential): child gets all remaining tree budget if no explicit allocation — natural for chains where parent passes everything down
- `task:delegate_group` (parallel): equal split of remaining across group size — knowable at delegation time since all tasks created at once
- Over-allocation: cap to remaining with warning in tool response ("Requested 80,000 but 30,000 remaining — allocated 30,000"). Hard fail if remaining is 0 (no zero-allocation conversations)

### Budget origin
- `treeBudget` field in definition.yaml, set by the operator — NOT on task:delegate
- Corrects BUD-01: root conversations start by event trigger via start(), not task:delegate. YAML origin ensures root's own usage is tracked from the start
- Started by event trigger (root) → treeBudget from definition.yaml activates
- Started by delegation (child) → inherits parent's allocation, its own treeBudget definition is ignored
- No treeBudget in definition.yaml → no tree enforcement (BUD-06 backward compatibility)

### Budget tracking
- Each conversation knows: subtreeAllocation (what parent gave it), subtreeConsumed (own + all descendants' usage)
- subtreeRemaining = subtreeAllocation - subtreeConsumed (computed, not stored as separate field)
- No global counter — root's allocation IS the tree budget, decomposes naturally through the hierarchy
- task:tree_budget tool computes by reading local state, no tree traversal needed

### Exhaustion behavior
- Warning at 80% consumed, hardcoded constant — not configurable per agent/tree
- Warning delivered as injected context message in the agent loop (same checkpoint as exhaustion check, softer action) — NOT via signal infrastructure
- Warning includes concrete numbers: tokens used, tokens remaining, percentage
- One-time delivery per conversation via warningDelivered flag
- Each conversation checks its own subtree (local check, no walk to root)

### Hard stop mechanics
- At 100%: current turn completes, then TreeBudgetExhaustedError (non-retryable, same pattern as TokenBudgetExhaustedError)
- No cleanup turn — the 80% warning IS the cleanup opportunity
- Check in agent loop before each LLM call (same location as per-conversation budget check)
- Parallel overshoot bounded at one turn per active conversation — acceptable tradeoff vs synchronized kill mechanism
- Waiting conversations discover exhaustion on first iteration after resume
- Failed with reason tree_budget_exhausted (distinct from token_budget_exhausted)

### Parent notification on child exhaustion
- No new signal type — child exhaustion flows through existing task settlement
- Parent either sees failure via wait_for resume or discovers its own budget exhaustion on next iteration
- For groups: PAR-05 signal aggregation handles it (all_required wakes on first failure)

### Agent interaction: context and tools
- Context injection at conversation start: one line with allocation and parent's total ("Tree budget: 80,000 tokens allocated from parent's 300,000 tree budget. Use task:tree_budget to check remaining.")
- task:tree_budget tool for mid-conversation dynamic state — allocated, consumed, remaining, percentage, descendant breakdown (active count, completed count, descendant consumed)
- Tool scoped to own subtree only — no sibling/parent visibility. Root naturally sees full tree since its subtree IS the tree
- No tree budget → no injection, no tool access (zero overhead for BUD-06 backward compat)

### Budget allocation parameter
- Optional `budgetAllocation` on task:delegate — absolute token count carved from parent's remaining
- Defaults apply when omitted (all remaining for sequential, equal split for groups)
- Absolute tokens, not percentage — consistent with tokenBudget, no computation needed
- For delegate_group: one budgetAllocation on the group that splits evenly. Per-task overrides deferred to v3.0

### Prompt guidance
- No prompt changes for budget management — system injection + warnings are sufficient
- No "Budget Management" section in prompt.md — this would be a state machine in natural language (anti-pattern per PROMPT_GUIDE.md)
- Agents naturally adjust from ambient awareness (context injection) and reactive warnings (80% message)

### Dashboard visualization
- Delegation graph (primary): budget bar on each node showing allocation/consumption with fill, color progression (neutral < 60%, warning 60-80%, critical > 80%, exhausted 100%). Root node shows total tree budget prominently
- Conversation detail (secondary): subtree budget section with own vs descendant split, progress bar, remaining/total. Section absent when no tree budget
- Static on page load, refresh on navigation — no SSE for budget state (low-frequency changes, threshold events already in SSE timeline)
- Tokens only on graph — no dollar estimates (cost estimation already in conversation detail via Phase 79)
- Warning/exhaustion events visible in existing event timeline

### Task status fix (tech debt)
- Add `failed` to taskStatusValues in all three locations (agents schema, agents schema.drizzle, dashboard schema)
- Database migration to allow the value
- Clean up dead refs where code references `failed` status that the schema doesn't officially support

### Claude's Discretion
- Exact schema design for storing subtreeAllocation and subtreeConsumed (new columns vs new table)
- How tree budget aggregation query works (recursive CTE vs denormalized tracking)
- Budget bar component styling within existing design system
- Migration strategy for adding failed status
- Event types for budget warning and exhaustion logging

</decisions>

<specifics>
## Specific Ideas

- "The allocation IS the message" — a child doesn't need to know the root's total budget. Its allocation reflects the parent's judgment about what it deserves
- Budget warning message format: "Tree budget warning: 82% consumed (246,000 / 300,000 tokens). 54,000 tokens remaining across this delegation tree. Prioritize completing essential work."
- Conversation detail budget section layout: progress bar + three numbers (own tokens, descendant tokens, remaining/total)
- task:tree_budget response shape includes descendants object: `{ active, completed, totalConsumed }` — helps agent reason about whether it or its children are consuming
- Shared pool was explicitly rejected for parallel delegation: "a fast, token-hungry child can exhaust the pool before siblings finish"

</specifics>

<deferred>
## Deferred Ideas

- Per-task budget overrides within delegate_group (v3.0 refinement if per-task allocation control needed beyond equal split)
- Tree-level cost summary on root's conversation detail (aggregate dollar amounts across tree)
- Burn rate chart / time-series budget visualization (requires new time-series storage infrastructure)
- Configurable warning threshold per agent (revisit only if 80% proves wrong across the board)

</deferred>

---

*Phase: 83-tree-level-token-budgets*
*Context gathered: 2026-02-23*
