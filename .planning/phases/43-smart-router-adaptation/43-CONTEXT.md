# Phase 43: Smart Router Adaptation - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Adapt the existing smart router to use ConversationExecutor instead of Temporal workflowClient. The router/ module is modified in-place (not rewritten). EventRouter (Phase 42) handles deterministic routing decisions; this phase wires adapters, EventRouter, and ConversationExecutor into the top-level routeEvent() function and adds missing adapters for events that currently lack domain-language normalization.

This code won't be live until Phase 44 wires the single service — no breakage risk, no feature flags needed in this phase.

</domain>

<decisions>
## Implementation Decisions

### Wiring strategy
- Replace router/router.ts **in-place** — matches spec's "adapted, not rewritten" intent and the "Modified" listing in the spec
- routeEvent() pipeline: adapter pipeline -> EventRouter.handle() -> execute decisions via ConversationExecutor.start()/signal()
- Pass-through adapter for unmatched events: if no specific adapter matches, wrap raw NormalizedEvent as generic IncomingEvent (preserving original dotted type like `github.issue_comment.created`) and let EventRouter return `slow_path` naturally — keeps one uniform code path for all events

### MCP enrichment removed from routing
- **Agent fetches its own context** — no MCP enrichment in routeEvent()
- Current v2.2 fetches issue details via callMcpTool (Linear get_issue) before starting dev-agent — this is the anti-pattern v2.2 design principles identified
- The agent has `linear:get_issue` in its tool list — it reads full issue details as its first action
- routeEvent() passes a minimal initial message (e.g., "Resolve Linear issue AES-42: 'Add /healthz endpoint'")
- This simplifies routing code: adapter -> EventRouter -> executor.start() with a message, no MCP calls in the routing layer

### Missing adapters (gap from Phase 42)
- Phase 42 adapters only cover events with clear start/signal mappings (approval, pr_merged, etc.)
- Events like `github.issue_comment.created`, `github.pull_request.review_submitted` have clear event types but ambiguous intent in their data — the event itself is unambiguous, the routing action requires LLM content analysis
- **Phase 43 adds adapters for remaining event types** to normalize them to domain language (e.g., `github.issue_comment.created` -> `"issue_comment"`)
- These events still go to slow-path for routing decisions, but arrive in domain language rather than raw integration format
- This aligns with the spec's "adapters normalize to domain language" intent for all events

### Slow-path invocation
- Direct call to routeViaAgentLoopV2() when EventRouter returns `{ action: "slow_path" }`
- No interface abstraction — follows "don't abstract for hypothetical futures" principle
- Phase 42 already adapted slow-path tools (start-conversation, signal-conversation, query-conversations) to use ConversationExecutor
- Fast-path: routeEvent() calls executor.start()/signal() directly
- Slow-path: routeEvent() delegates to LLM loop which calls executor via tools — both hit executor, slow-path adds LLM reasoning step

### HTTP response model
- **Unified 200 for all paths** — webhook callers just need a quick ack
- Response body includes metadata: `{ received: true, action: "started", conversationId: "dev-agent-AES-42" }` for fast-path; `{ received: true, action: "classifying" }` for slow-path
- Slow-path is **fire-and-forget** — returns 200 immediately, processes in background (LLM classification takes seconds, would block webhook callers)
- If agents need to communicate results, they use appropriate MCP tools (Slack, Linear) — not the HTTP response

### Error & alert handling
- **Routing failures only** get Slack alerts — routeEvent() catches executor errors
- Alerts are for the **operations team**, not end users — generic "Something went wrong processing event X. Check logs." message, no stack traces in Slack
- **Idempotent results** (conversation already exists, signal deduplicated) → log only, no alert
- **Actual failures** (DB errors, adapter errors, service down) → log + single generic Slack alert
- Uses callMcpTool() directly for alerts (same as v2.2) — infrastructure code, not an agent
- Agent-level failures handled by executor (event log, stale detection) — separate from routing alerts

### Claude's Discretion
- Exact adapter implementations for newly added event types (same pattern as Phase 42 adapters)
- Internal structure of the pass-through adapter for unmatched events
- Log levels and log message format for different error categories
- Exact response body shape (field names, structure)

</decisions>

<specifics>
## Specific Ideas

- "v2.2 ended up being a bit of a half measure" regarding agent-first — removing MCP enrichment from routing completes the shift
- Event types are always clear (github.issue_comment.created = "a comment was created"); what's ambiguous is the **intent within the data** (review response, question, noise) — that's why slow-path exists
- "I don't want to spam slack with the equivalent of a stack trace that means nothing to end users. A generic something is wrong kind of thing (once) for platform errors is enough, everything else is logs and/or monitoring for us"
- The old router code won't be used until Phase 44 wires the single service — ensure future phases pick up the adapted router, not the old Temporal path

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 43-smart-router-adaptation*
*Context gathered: 2026-02-03*
