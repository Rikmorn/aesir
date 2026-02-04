# Phase 54: System Overview - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Landing page (`/`) giving an instant pulse check on the system — conversation status counts, active conversations, worker health, recent errors, and token consumption over the last 24h. All data is read-only from existing Postgres tables and the agent-service worker status API. No new database tables, no real-time SSE wiring (that's Phase 55).

</domain>

<decisions>
## Implementation Decisions

### Page layout & density
- Top row: stat cards showing conversation counts by status (running, waiting, queued, completed 24h, failed 24h) — follows the card grid pattern used across agents and tools pages
- Below stats: two-column responsive grid (`lg:grid-cols-2`) with Active Conversations (left) and Worker Status (right)
- Below that: two-column grid with Recent Errors (left) and Token Usage (right)
- Full-width container with standard header pattern (`text-2xl font-bold` title + `text-muted-foreground` subtitle)
- Consistent spacing: `space-y-6` between sections, `gap-4` within grids

### Status summary design
- Five stat cards in a responsive row (`grid-cols-2 md:grid-cols-3 xl:grid-cols-5`)
- Each card: count as large number (`text-3xl font-bold`), label below (`text-sm text-muted-foreground`)
- Color-coded count text: emerald for completed, red for failed, default foreground for running/waiting/queued
- Uses `Card` + `CardHeader` + `CardContent` pattern consistent with tools integration health cards

### Active conversations display
- Table inside a Card — sorted by longest running first (duration descending)
- Columns: Agent name, Status badge, Duration (live-formatted), Last event type, Link to detail
- Max 10 items shown, with a "View all" link to `/conversations?status=running,waiting` for overflow
- Long-running items (>1 hour) get a subtle visual indicator (amber text on duration)
- Empty state: dashed border box with "No active conversations" message

### Recent errors display
- List of last 10 failed conversations or tool failures inside a Card
- Each row: timestamp, agent name, error excerpt (truncated), link to conversation detail
- Failed conversations and tool failures interleaved, sorted by recency
- Uses `text-red-600 dark:text-red-400` for error text, consistent with tools failures tab
- Empty state: dashed border with "No recent errors" message

### Token usage breakdown
- Headline total: large number card showing total tokens (input + output) in last 24h
- Per-agent breakdown: horizontal bar chart (Recharts BarChart) showing input vs output tokens stacked per agent
- Uses `ChartContainer` wrapper with `ChartTooltip` and `ChartLegend` consistent with tools performance charts
- Chart config: two series — input tokens and output tokens with distinct chart colors
- Empty state if no LLM calls in 24h

### Worker status display
- Card with key-value metadata list using `dl` grid pattern (`grid-cols-2 gap-x-4 gap-y-2`)
- Fields: Active claims / Max concurrent (as "X / Y"), Poll interval (formatted), Last poll time (relative), Uptime (formatted duration)
- Status dot: emerald if active claims < max concurrent, amber if at capacity
- Data from agent-service API (`GET /api/worker/status`)

### Claude's Discretion
- Exact stat card icon choices (or no icons — text-only cards may be cleaner)
- Whether stat cards include a small sparkline or just raw counts
- Exact responsive breakpoints for the two-column → single-column transition
- Loading skeleton design for each section
- Whether worker status card includes a visual capacity gauge or just numbers
- Error row truncation length for error messages

</decisions>

<specifics>
## Specific Ideas

- Token usage should show a headline total number plus per-agent breakdown (user confirmed)
- Follow the exact same container, header, card, and chart patterns already established in conversations, agents, and tools pages — consistency over novelty
- Active conversations sorted by longest-running first to surface potentially stuck items
- The page should answer "is the system healthy right now?" at a glance — stat cards at top provide this

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 54-system-overview*
*Context gathered: 2026-02-04*
