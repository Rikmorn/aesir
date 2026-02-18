# Phase 78: Work Correlation - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the platform a formal concept of "what work exists for entity X" with a correlation registry, agent tools (work:register, work:query), router fallback routing, and a disposition vocabulary. Enables the router and agents to check existing work before starting duplicates. ISS-016 (duplicate task trees) is the immediate symptom; work correlation is the underlying capability.

</domain>

<decisions>
## Implementation Decisions

### Registration behavior
- **Dual-layer registration:** Executor auto-registers the trigger entity at `start()` (infrastructure fact, same pattern as `reply_context`). Agents explicitly register additional entities via `work:register` (agent judgment for secondary entities discovered during execution).
- **No auto-registration for sub-agents:** Delegated conversations have no trigger entity. Sub-agents use `work:register` only if they create/own external entities (e.g., dev-agent opening a PR). Most sub-agents (coder, researcher, tester) won't need correlation.
- **Trust agent input:** `work:register` validates shape only (Zod: entity_type enum, entity_id non-empty string). No MCP round-trips to verify entity existence. Agents get IDs from tool results — redundant validation adds failure modes and integration coupling.
- **Correlation lifecycle:** Correlations persist with terminal status (completed, failed, superseded). Never deleted — disposition vocabulary requires terminal correlations for `retry` and `supersede` decisions. Table growth is trivially small (1-3 correlations per conversation). TTL-based cleanup of old terminal correlations deferred to post-v2.8 if needed.

### Routing precedence
- **Trigger first, correlation fallback:** Existing trigger matching runs first (unchanged). Signal routing (wait_for matching) second. Correlation lookup only fires when neither matches. Correlation augments the pipeline, never overrides it.
- **Pipeline ordering:** Event → Phase 2 filters → trigger rules → signal routing → correlation lookup → slow-path LLM (with enriched context) → ignore.
- **`start()` idempotency prevents trigger duplicates:** Same correlationKey = same conversation ID. Two trigger events for the same entity don't create duplicate conversations — existing infrastructure handles this.
- **Pre-enrich, don't tool:** Correlation data is automatically injected into slow-path LLM context. No new router tool. The lookup is deterministic (always do it for slow-path events), and the LLM's job is to decide, not discover.
- **New signal type needed:** Correlation-routed events use `entity_update` signal type (carries original event payload). Agent receives it and decides relevance from payload content.

### Multi-correlation handling
- **Broadcast all active/waiting:** When multiple conversations correlate with the same entity, signal all of them. Each agent decides relevance. Cost is low (MAX_DELEGATION_DEPTH = 5, most waiting), missed delivery risk is high.
- **Primary entity only from adapters:** Each event produces one entity reference from structured payload fields (Linear: `issueId`, GitHub: `pull_request.number`, Slack: `channelId:threadTs`). No cross-reference parsing from free text. Cross-entity bridges are created by agents via `work:register`.
- **Entity reference is optional on IncomingEvent:** Some events don't map to an entity (agent_session.created, workspace-level events, top-level Slack messages). Adapters set it when structurally clear, omit when not. No entity → skip correlation lookup → fall through to existing routing.

### Disposition boundaries
- **Router-only vocabulary for v2.8:** The 5 dispositions (new, signal, retry, supersede, duplicate) are internal to the routing pipeline. Agents use `work:query` to get correlation data and reason in natural language — no enum classification.
- **Deterministic vs judgment split:**
  - `duplicate` — Phase 2 filters (deterministic infrastructure)
  - `signal` — Correlation fallback, active/waiting status (deterministic infrastructure)
  - `new` — Correlation fallback, no correlation found (deterministic infrastructure)
  - `retry` — Slow-path LLM with enriched context (judgment)
  - `supersede` — Slow-path LLM with enriched context (judgment)
- **Supersede mechanics:** Start new conversation + update old correlation status to `superseded`. No active cancellation of old conversations — they reach terminal state naturally (token budget, max iterations, timeout). Graceful cancellation deferred to v2.9 agent lifecycle features.
- **Emit `event.routed` events:** Router emits disposition events with entity, disposition, routing method (trigger_match, signal_match, correlation_fallback, slow_path), target conversation, and LLM reasoning (for slow-path). Skip emitting for duplicate/ignore. Dashboard renders these for routing provenance debugging.

### Knowledge query extension
- **Extend existing `knowledge:query`:** Add `mode` parameter (semantic/exact/combined, default semantic) and optional `metadata` filter. No new tool — one tool, one purpose, backward compatible.
- **Mode behavior:** `semantic` = current embedding search (unchanged). `exact` = metadata WHERE clause only. `combined` = filter by metadata, then rank by semantic similarity within matches.
- **Metadata JSONB column** added to knowledge entries for structured data (issue IDs, PR numbers, branch names).

### Claude's Discretion
- Correlation table schema details (indexes, constraints beyond the spec's outline)
- `entity_update` signal payload structure
- `event.routed` storage (routing_decisions table vs system event log)
- knowledge:query combined mode implementation details (SQL strategy)
- Agent prompt guidance wording for work:register and work:query usage

</decisions>

<specifics>
## Specific Ideas

- Registration model summary table from discussion:

| Conversation type | Trigger entity | Auto-register? | work:register? |
|---|---|---|---|
| Webhook-triggered | From adapter | Yes | For secondary entities |
| Delegated (sub-agent) | None | No | If it creates/owns external entities |

- Correlation status decision table for router:

| Correlation status | Router action |
|---|---|
| active / waiting | Signal directly (deterministic) |
| failed | Slow-path LLM with enriched context |
| completed | Slow-path LLM with enriched context |
| superseded | Treat as no active correlation |
| None | Slow-path or ignore (as today) |

- Pre-enriched slow-path context example:
  ```
  Event: issue.comment on LIN-456 by @alice
    "Can we also handle the edge case for empty inputs?"

  Existing work for LIN-456:
    - Conversation C-789 (dev-agent), status: waiting, started 1h ago
      Task: "Implement input validation for auth endpoint"
  ```

- `event.routed` routing_method enum: trigger_match, signal_match, correlation_fallback, slow_path

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 78-work-correlation*
*Context gathered: 2026-02-17*
