# Phase 35: Guardrails & Cleanup - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Enforce safety guardrails across all agents (token budgets, merge protection, retry config) and completely remove all LangGraph code and dependencies from the codebase. This phase hardens the v2.2 agentic architecture and eliminates the legacy state machine framework.

</domain>

<decisions>
## Implementation Decisions

### Token budget enforcement
- Per-task budget only (shared pool across orchestrator + all sub-agents) — current `TokenBudget` implementation stays
- No per-agent-type caps — sub-agents naturally constrained by orchestrator delegation
- When budget hits ~20% remaining: log warning in execution traces AND send Slack notification to user ("Budget running low on AES-42, 80% used, ~100K remaining")
- On full exhaustion: graceful wrap-up — reserve a small token buffer (~5K) for a final summarization call before stopping, so context is useful for resumption
- Budget configuration: Claude's discretion on where to put the config (env var, agent config, etc.) — keep it simple, more controls deferred to a future phase

### Cost tracking granularity
- Tokens only for now — no dollar cost calculation. Pricing is volatile; raw token counts are stable and sufficient
- Query patterns and aggregation strategy: Claude's discretion — researcher should evaluate expected data volumes and recommend whether query-time aggregation or materialized summaries make more sense for a future dashboard
- Cost alerting: Claude's discretion — evaluate whether the token budget cap alone is sufficient or if a separate alert threshold adds value

### LangGraph removal — NUCLEAR
- Delete ALL LangGraph files: graph definitions, node implementations, state schemas, phase enums, `routeByPhase()`, `code-workflow/` directory
- Remove ALL 4 `@langchain/*` dependencies from package.json: `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`
- Delete `PostgresSaver` checkpointer code and drop checkpoint tables — no concern about historical data, clean break
- Delete ALL test files that test deleted code — no orphan tests
- Clean up ALL backward-compat re-exports that only existed for LangGraph consumers
- Final verification: grep entire codebase for any remaining `@langchain`, `langgraph`, `LangGraph`, `PostgresSaver` references — zero tolerance for leftovers
- Clean up barrel exports, re-exports, and any orphaned types/helpers

### Command sandbox policy
- Container isolation (DevContainerManager) is sufficient for now — no command-level allowlist or blocklist at the agents layer
- Command-level restrictions deferred to a future security hardening phase
- `merge_pull_request` removed from ALL agent toolkits — not available as a tool at all
- System prompts educate agents about the human review process ("humans review and merge PRs") — agents understand the concept without having the capability
- This is defense-in-depth: even prompt injection or confused agent reasoning cannot trigger a merge

### Temporal activity retry config
- MUST be revisited for agentic loops — current config (3 retries with backoff) was designed for deterministic LangGraph activities, not LLM-heavy non-deterministic loops
- Researcher should investigate appropriate retry strategies for LLM activities (retry count, backoff, idempotency concerns)
- Different retry configs likely needed for orchestrator activities vs infrastructure activities (already split in Phase 32)

### Claude's Discretion
- Cost tracking aggregation strategy (query-time vs materialized)
- Whether to add dollar-based cost alerting beyond token budget caps
- Token budget configuration mechanism (env var vs config)
- Specific retry counts and backoff settings for agentic activities (after research)
- Any additional cleanup opportunities discovered during LangGraph removal

</decisions>

<specifics>
## Specific Ideas

- "NUCLEAR" approach to LangGraph removal — zero tolerance for leftovers, grep and destroy
- Token budget warning should go to both traces (for debugging) and Slack (for user awareness)
- Graceful wrap-up on budget exhaustion — reserve buffer for final summarization, not hard stop
- README updates (main and package-level) have drifted from current architecture — should be refreshed
- Future dashboard will need cost data — design tracking with that in mind even though dashboard is out of scope

</specifics>

<deferred>
## Deferred Ideas

- Per-agent-type token caps (prevent single sub-agent consuming whole budget) — future guardrails enhancement
- Dollar cost calculation and pricing models — future dashboard/billing phase
- Per-task budget overrides via Linear labels — future configurability
- Command-level allowlist/blocklist for run_command — future security hardening phase
- Cost dashboard UI — out of scope for v2.2 entirely
- README and documentation refresh — could be folded into this phase's cleanup or done separately

</deferred>

---

*Phase: 35-guardrails-cleanup*
*Context gathered: 2026-01-30*
