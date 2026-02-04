# Phase 51: Conversation Detail - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Single-page deep dive into one agent conversation. Three panels: event timeline (chronological agent_events), message history (LLM conversation from conversations.messages), and metadata sidebar. Replaces SQL-based debugging with a visual interface. Navigation from conversations list (Phase 50) is the entry point. Real-time event streaming is Phase 55's concern — this phase renders static/server-fetched data.

</domain>

<decisions>
## Implementation Decisions

### Event timeline — expand/collapse behavior
- Failed events (tool.failed) auto-expand so errors are immediately visible
- All other events collapsed by default — clean, scannable timeline for long conversations
- User explicitly chose this: optimized for debugging workflows

### Metadata sidebar
- Collapsible — can be toggled open/closed to save horizontal space when focused on timeline or messages
- User explicitly chose this

### Design direction
- Follow contemporary developer tool patterns: Linear activity feeds, Vercel deployment logs, Claude.ai tool use display
- Functional over polished — ship a working debugging tool, iterate on visual refinements later

### Claude's Discretion
The following areas are open for Claude to decide during planning/implementation, following the design direction above:

**Event timeline rendering:**
- Tool call pairing strategy (whether tool.called + tool.succeeded/failed render as paired rows or separate events)
- Visual hierarchy and differentiation between event types (icons, colors, typography weight)
- Large payload handling (truncation strategy, scrollable containers, or both)
- Timeline rail design (vertical line with nodes, flat list with type indicators, etc.)

**Sub-agent presentation:**
- How child conversation events appear in parent timeline (collapsible inline block vs link-only row)
- Nesting depth handling (one level inline vs recursive vs link-through for deeper levels)
- Navigation pattern for parent/child relationships (breadcrumb chain vs sidebar links)

**Message panel design:**
- System prompt treatment (collapsed by default vs hidden with toggle)
- Tool use/result block rendering (styled inline blocks vs minimal references linking to timeline)
- Code block syntax highlighting approach
- Message panel relationship to timeline (side-by-side vs tabbed)

**Page layout:**
- Timeline vs messages arrangement (side-by-side columns or tabbed switching)
- Overall three-panel proportions and responsive behavior

</decisions>

<specifics>
## Specific Ideas

- "Happy to follow accepted and contemporary examples like Linear or Vercel" — use these as reference points for timeline and activity feed patterns
- Linear's activity feed as a model for event timeline visual treatment
- Vercel's deployment logs as a model for expandable log entries with status indicators
- Claude.ai's tool use display as a reference for how tool call blocks render in message views
- Expect this to be iterated on — build a solid foundation that's easy to refine

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 51-conversation-detail*
*Context gathered: 2026-02-04*
