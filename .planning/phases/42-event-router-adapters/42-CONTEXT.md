# Phase 42: Event Router + Adapters - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Adapter pattern normalizes incoming `NormalizedEvent` objects (already produced by integration services) into domain-language `IncomingEvent` types, and the EventRouter matches events against agent trigger rules for start or correlation-based signal delivery. This phase does NOT modify integration packages, the smart router's slow-path LLM classification, or the existing fast-path rule structure.

</domain>

<decisions>
## Implementation Decisions

### Adapter input format
- Adapters consume existing `NormalizedEvent` (dotted types like `slack.block_actions.approved`) — NOT raw webhook payloads
- Adapters are thin mappers: `NormalizedEvent` → `IncomingEvent` (domain-language types like `"approval"`)
- Integration packages continue producing `NormalizedEvent` unchanged — no changes to `@aesir/integration-*`
- This keeps integration packages marked "unchanged" per spec and minimizes change surface

### PR review routing
- Keep PR reviews (`github.pull_request.review_submitted`) on slow-path LLM routing for now
- Rationale: PR reviews carry nuance — could be simple approval, could surface unexpected requirements or architectural concerns that need human judgment about whether to route or escalate
- Measure actual routing decisions in production; promote to fast-path only when data shows the vast majority are straightforward

### Slack thread reply routing
- Keep thread replies (`slack.message.created` in threads) on slow-path LLM routing for now
- Same rationale as PR reviews: thread replies can be noise, clarifications, or substantive new requirements
- The LLM provides nuance that deterministic matching can't
- Promote to fast-path later based on observed patterns

### General fast-path philosophy
- Err on the side of leveraging the LLM for routing decisions
- Only promote to fast-path when real-world data shows the vast majority of a given event type are "dumb" (unambiguous, always routed the same way)
- The router architecture should make it trivial to add new fast-path rules — just append to the rules array

### Claude's Discretion
- Exact adapter function signatures and internal structure
- Whether to reuse existing `NormalizedEvent` type directly or create a narrower input type for adapters
- How to structure the EventRouter's dependency on AgentRegistry for trigger rules
- Implementation of the `IncomingEvent.message` field construction in each adapter

</decisions>

<specifics>
## Specific Ideas

- Existing `NormalizedEvent` schema in `@aesir/types` with dotted-notation types is the adapter input — no new webhook parsing needed
- The 10 existing fast-path rules in `packages/agents/src/router/fast-path.ts` define the deterministic routing logic that gets refactored into the EventRouter
- MCP enrichment pattern (fetching issue details before dev-agent start) should carry forward
- Adapter message examples from spec section B.4 define the human-readable `message` field format for each signal type
- Conversation ID formula from spec section B.5: `{agentDefinitionId}-{correlationKey}` — already matches existing derivation (`dev-agent-{issueId}`, `product-agent-{threadTs}`)

</specifics>

<deferred>
## Deferred Ideas

- Promoting PR reviews to fast-path — measure first, optimize based on data
- Promoting thread replies to fast-path — same approach
- Raw webhook payload adapters (bypassing NormalizedEvent) — only if integration package changes are needed later

</deferred>

---

*Phase: 42-event-router-adapters*
*Context gathered: 2026-02-02*
