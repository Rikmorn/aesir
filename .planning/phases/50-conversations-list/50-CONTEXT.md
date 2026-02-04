# Phase 50: Conversations List - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Filterable table view of all agent conversations at `/conversations`. Users can see agent name, status, duration, token usage, and last activity at a glance. Filtering by status, agent type, time range, and has-errors narrows the list. This phase delivers the list page only — conversation detail is Phase 51, real-time SSE updates are Phase 55.

</domain>

<decisions>
## Implementation Decisions

### Columns & data
- Columns specified in spec: agent name (from `agent_definition_id`), status badge, trigger event type, duration, token usage (input + output from `llm.response` events), last activity (from `agent_sessions.last_event_at`), error indicator
- Token usage aggregated from `agent_events` via LATERAL join (see spec Appendix B.1)
- Data sources: `agents.conversations` + `agents.agent_sessions` + `agent_events` aggregation

### Filters
- Status: multi-select (queued, running, waiting, completed, failed)
- Agent type: multi-select from distinct `agent_definition_id` values
- Time range: last hour, last 24h, last 7d, custom
- Has errors: boolean toggle
- Filters specified in the spec — no additional filters needed

### Pagination
- Traditional page-based pagination (page numbers at bottom)
- URL-shareable page state (query params for page, filters)

### Visual treatment
- Standard shadcn/ui table patterns (DataTable)
- Contemporary, clean aesthetic — Vercel/Linear as reference if needed
- Status badges with color coding (standard semantic colors: green for completed, red for failed, yellow for waiting, blue for running)
- Failed/errored rows should be visually distinct but not overwhelming

### Claude's Discretion
- Default time range for initial page load (recommend last 24h for performance)
- Default sort order (recommend newest first)
- Row density and spacing
- Loading skeleton design
- Empty state messaging and illustration
- Exact filter placement (toolbar vs sidebar — toolbar is standard for tables)
- Error state handling for failed data fetches
- Column widths and responsive behavior (desktop-only per spec)

</decisions>

<specifics>
## Specific Ideas

- Spec provides exact SQL query patterns in Appendix B.1 — service layer should follow these closely
- Service layer pattern already established in Phase 49 (`src/services/`) — this phase adds conversation list queries
- Existing database indexes support the primary query patterns (see spec Appendix B.1)
- No real-time updates in this phase — that's Phase 55 scope
- Page should link to conversation detail (`/conversations/[id]`) but detail page is Phase 51

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 50-conversations-list*
*Context gathered: 2026-02-04*
