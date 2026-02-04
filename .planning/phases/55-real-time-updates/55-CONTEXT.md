# Phase 55: Real-Time Updates - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the existing SSE backend (Phase 48's `GET /api/sse/events` on the agent service) into the dashboard's React pages. Create a `useEventStream` hook and integrate it into three pages: conversations list, conversation detail, and system overview. No SSE backend changes — the endpoint, EventLog subscription, EventBuffer, connection management, and graceful shutdown are all complete.

</domain>

<decisions>
## Implementation Decisions

### Update behavior
- **Claude's Discretion** — user deferred all update behavior decisions (row update style, list re-sorting, timeline auto-scroll, overview stat animations) to Claude. Follow UI/UX best practices consistent with the existing dashboard pages.

### Connection UX
- **Claude's Discretion** — user deferred all connection UX decisions (disconnect indicator, reconnect strategy, connection scope, live indicator) to Claude. Pick approaches that fit the existing dashboard patterns and developer-focused monitoring context.

### Page-specific wiring — Conversations list
- Server-side SSE type filtering (`?types=` parameter) for conversations list — only receive lifecycle events (started, completed, failed, paused, resumed), not all events
- New conversations and status changes should update the list (exact pattern — auto-appear vs banner — is Claude's discretion)

### Page-specific wiring — Conversation detail
- **Both panels live**: Event timeline AND messages panel both update in real-time when viewing a running conversation
- Metadata sidebar live updates are Claude's discretion
- Client-side event buffer capped at 1000 events, with a "load earlier" mechanism for conversations with more events

### Page-specific wiring — System overview
- **Full live list**: Active conversations list AND stat counts both update in real-time — conversations appear/disappear as they start/complete

### Event granularity
- **Batched updates at 500ms**: Collect SSE events in a buffer and apply as a batch every 500ms (not per-event React state updates)
- **Server-side filtering**: Use the SSE `?types=` parameter to reduce bandwidth — each page subscribes to only the event types it needs
- Token total and duration refresh strategy is Claude's discretion

### Claude's Discretion
- Row update animation style (instant, highlight, fade)
- List re-sorting behavior on status change
- Timeline auto-scroll behavior (auto-scroll vs indicator vs smart)
- Overview stat card animation (instant vs animated counters)
- Disconnect/reconnect UX (silent, banner, or status dot)
- Reconnect sync strategy (Last-Event-ID replay, refetch, or hybrid)
- Connection scope (per-page vs shared at layout level)
- Live update indicator presence
- New conversation appearance in list (auto-appear vs "N new" banner)
- Metadata sidebar live updates on detail page
- Token total/duration refresh approach on detail page

</decisions>

<specifics>
## Specific Ideas

- Follow UI/UX best practices and keep them consistent with previous dashboard phases (user's explicit instruction)
- The SSE backend already supports: `?conversationId=` filter, `?types=` filter, Last-Event-ID replay with gap detection, 50 connection limit, 20s keepalive pings, 3s retry interval
- EventBuffer on the server holds 1000 events for replay
- Dashboard is currently all server components with `force-dynamic` — real-time pages will need client component wrappers

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 55-real-time-updates*
*Context gathered: 2026-02-04*
