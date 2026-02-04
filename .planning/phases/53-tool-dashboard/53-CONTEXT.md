# Phase 53: Tool Dashboard - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Unified tool visibility layer on a single `/tools` page. Shows all registered tools organized by namespace, agent-to-tool permission matrix with mismatch detection, tool performance metrics with simple charts, recent failure history, and integration health status. Read-only — no tool configuration editing.

</domain>

<decisions>
## Implementation Decisions

### Page structure
- Claude's discretion on layout approach (tabbed vs sectioned scroll) — pick what best fits the 5 sections and the existing dashboard patterns from phases 50-52
- Keep consistent with the visual language already established (Linear/Vercel-inspired, clean, minimal chrome)
- Must accommodate 5 sections: Tool Registry, Permission Matrix, Tool Performance, Recent Failures, Integration Health

### Tool registry display
- Claude's discretion on whether to show config-focus (name, description, agents) or metrics-focus (call volume, failure rate) or both inline per tool
- Tools organized by namespace (codebase, coordination, linear, github, slack) — this is fixed from the spec
- Single `/tools` page — Claude decides whether individual tool detail pages (`/tools/[id]`) are warranted based on data depth available, or if expandable rows/cards on the main page suffice

### Permission matrix
- Cross-reference agent definitions (YAML) with MCP database permissions (linear, github, slack tables)
- Claude's discretion on mismatch highlighting approach — inline cell warnings vs summary banner, whichever is most actionable
- Matrix covers ~5 agents x ~28 tools — scale is manageable

### Metrics and charts
- Simple charts for trends (adds a chart library — recharts or similar)
- Default time range: **last 1 hour** with options for 24h, 7d
- Show call volume, failure rate, latency (p50, p95)
- Claude's discretion on chart types and layout

### Recent failures
- Show **last 25 failures** with pagination
- Each failure shows: timestamp, tool name, agent, conversation link, error payload (expandable), duration
- Filterable by namespace, agent type, time range

### Integration health
- Show status of Linear, GitHub, Slack MCP endpoints
- Data from agent-service API (`GET /api/tools/health`)
- Claude's discretion on placement and visual treatment

### Claude's Discretion
- Overall page layout approach (tabs vs scroll sections)
- Tool registry information density (config vs metrics vs both)
- Whether to add tool detail pages or keep everything on `/tools`
- Permission mismatch warning style
- Chart library choice and chart styling
- Integration health visual treatment
- Loading skeleton design
- Empty states for each section

</decisions>

<specifics>
## Specific Ideas

- "Either Vercel-style or Linear-style is fine, just make it consistent" with the existing dashboard
- Simple charts explicitly requested over numeric-only — this is worth the chart library dependency
- Default time range corrected to 1 hour (not 24h) — agents run in short bursts, recent data is most relevant
- Last 25 failures with pagination unless it's too messy — fall back to 10 if pagination adds too much complexity

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 53-tool-dashboard*
*Context gathered: 2026-02-04*
