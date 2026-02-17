# Phase 77: Dashboard Observability - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the conversation detail timeline tell the complete story of every conversation. Render lifecycle events, group tool calls into expandable cards, visually attribute sub-agent work, display MCP/notification error events with severity, and show summary metrics. Filter chips for targeted debugging. No new data infrastructure — work with existing event log schema (type as text, payload as JSONB).

</domain>

<decisions>
## Implementation Decisions

### Tool call cards
- Group tool events (tool.called + tool.succeeded/tool.failed) by `toolCallId` into a single expandable card
- Collapsed state: tool name + success/fail badge + duration + truncated output preview (~80 chars). Two lines per card.
- Expanded state: two collapsible sections — **Input** (formatted JSON, collapsed by default) and **Output** (formatted JSON, collapsed by default but auto-expanded on failure)
- Duration + timestamp pinned visible when expanded so context isn't lost scrolling through payloads
- All cards collapsed by default except failures — failures auto-expand with red left border + destructive background
- The three underlying events (called, succeeded, failed) are hidden — grouping replaces them
- MCP error events (mcp.error, mcp.rate_limited, mcp.retries_exhausted) render inside the tool card that caused them, not as separate timeline entries. If the tool succeeded after rate-limit retries, show a subtle indicator (e.g., "succeeded after 2 retries, 1.2s backoff"). Requires toolCallId correlation in MCP event payload — if missing, that's a gap to fix in the agent-service event emission.

### Sub-agent visual hierarchy
- One chronological timeline — sub-agent events indented with an agent name pill, not separate lanes or collapsible groups
- Agent name pill: small colored chip before event content (e.g., `[researcher]`). Muted background, small text, consistent color per agentDefinitionId (hash to pick from 4-6 muted palette colors)
- Single indent level only — each conversation view only shows orchestrator + direct sub-agents. Child sub-agents run in separate conversations (click through to see)
- Sub-agent spawn (agent.started with parentInstanceId): render as "Spawned {agentId}" with task excerpt, not generic "Agent Started"
- Sub-agent complete (agent.completed with parentInstanceId): render as "{agentId} completed" with output preview. Failure gets same red treatment as failed tool cards
- Top-level agent.started/agent.completed (no parentInstanceId) keep current lifecycle treatment

### Lifecycle & error events
- Lifecycle events (paused, resumed, reopened, stale_recovered, retry_scheduled) render as thin full-width banners, not cards
- One line: icon + label + short description from payload + timestamp
- Muted styling — lower contrast than tool cards and LLM responses
- No collapse/expand — the banner is the whole story
- Severity exceptions:
  - `agent.stale_recovered` and `agent.retry_scheduled`: amber/warning treatment
  - `notification.failed`: red/destructive treatment (standalone lifecycle banner, not inside a tool card — it's not about a tool the agent called)
  - Everything else (paused, resumed, reopened): neutral/muted
- No schema/migration changes for new event types — dashboard renders based on type string with a known-type-to-styled-renderer mapping and a generic JSON fallback for unknown types
- Generic fallback: type label + formatted JSON payload — new event types are visible immediately without a dashboard deploy

### Filter chips
- Row of toggle chips above the timeline: `Failures` | `Lifecycle` | `Tool calls` | `LLM` | one chip per sub-agent name (dynamic, only if sub-agents exist in this conversation)
- Click to toggle on/off, multiple active at once, all on by default
- Two target workflows: "What went wrong?" (Failures only) and "What did {agent} do?" (specific sub-agent only)
- No saved filters, no text search, no time range — keep it simple

### Summary metrics
- Compact stats bar above the timeline, always visible, one line
- Metrics: wall-clock duration | input tokens | output tokens | tool success rate (N/M succeeded) | retry count
- No cost estimate — requires pricing config, model-specific rates, and multi-model handling. Tokens are accurate and sufficient. Cost estimation is a separate feature if it earns its place later.
- Live-updating via SSE: metrics are a running accumulation from the same event stream that powers the timeline. Increment tokens, increment tool counts as events arrive.
- Use existing `formatTokenCount()` and `formatDurationMs()` from `lib/format.ts` — match dashboard conventions

### Timeline ordering & navigation
- Sort order: chronological always (oldest first)
- Active conversations: auto-scroll to bottom as new events arrive (already exists)
- Completed conversations: jump-to-end button to skip to the latest events
- Combined with filter chips (Failures only) and auto-expand on failure, this covers the "find what went wrong" workflow without reversing the timeline

### Claude's Discretion
- Exact icon choices for each event type (from design system icon set)
- Spacing between timeline items and padding within tool cards
- Agent pill color palette selection (4-6 muted colors)
- Generic fallback renderer styling for unknown event types
- Jump-to-end button placement and styling
- Filter chip visual treatment (active/inactive states)

</decisions>

<specifics>
## Specific Ideas

- "When you're debugging, you scroll until you see red" — failed tool cards must visually scream in the timeline
- "The event log was designed this way. Don't fight it." — no schema changes, render from type + payload
- "Don't build nesting you'll never render" — each conversation only ever has orchestrator + direct sub-agents
- Sub-agent spawn/complete should read as parent-child context ("Spawned researcher"), not standalone lifecycle moments ("Agent Started")
- MCP errors belong with the tool call that caused them, not floating independently
- "If you have to navigate away from the timeline to see metrics, you won't look" — stats bar always visible above timeline

</specifics>

<deferred>
## Deferred Ideas

- Cost estimation from token counts — requires pricing config, model-specific rates, multi-model support. Separate feature.
- Text search within events — forensics-level analysis belongs in logs/SQL, not dashboard
- Saved filter presets — complexity not justified for current usage
- Time range filtering — same as above

</deferred>

---

*Phase: 77-dashboard-observability*
*Context gathered: 2026-02-17*
