# Phase 52: Agent Definitions View - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can see what agents exist, how they're configured, and what they've been doing recently -- without reading YAML files or grepping code. Two pages: an agent list page (`/agents`) and an agent detail page (`/agents/[id]`). Data sourced from the agent-service runtime registry API (Phase 48), not from YAML files on disk. Recent conversations come from the database.

</domain>

<decisions>
## Implementation Decisions

### Presentation & Layout
- Follow modern dashboard conventions (Linear, Vercel style) for all layout and visual decisions
- Claude has full discretion on card vs table, visual hierarchy, spacing, typography, information density
- Server components by default (read-heavy pages), consistent with existing dashboard patterns

### Agent List Page (`/agents`)
- Show all loaded agent definitions from `GET /api/agents/registry`
- Each agent shows: name, ID, description, model, tool count, sub-agents (if any), trigger events, version
- Orchestrator agents (dev-agent, product-agent) vs sub-agents (coder, researcher, tester) should be distinguishable at a glance

### Agent Detail Page (`/agents/[id]`)
- Full configuration display: model, temperature, maxIterations, tokenBudget, history settings
- System prompt rendered as Markdown, collapsible (prompts are 2000+ lines)
- Tools listed with namespace grouping (codebase, coordination, linear, github, slack)
- Sub-agent references shown with links to their detail pages (`/agents/[sub-agent-id]`)

### Tool Links (Future-Ready)
- Tools on the agent detail page link to `/tools?tool=namespace:tool_name`
- These links will 404 until Phase 53 ships the tool dashboard, but will work once it exists
- Sub-agent links go to `/agents/[id]` and work immediately within this phase

### Recent Conversations
- Agent detail page shows last 10 conversations for that agent type
- Columns: status badge, duration, token usage, last activity (consistent with conversations list)
- "View all" link navigates to `/conversations?agent=[agent-id]` (filtered conversations list)
- Data source: database query on `agents.conversations` filtered by `agent_definition_id`

### Data Source Architecture
- Agent definitions: `GET /api/agents/registry` (list) and `GET /api/agents/registry/:id` (detail with system prompt)
- Recent conversations: database query via service layer (same pattern as Phase 50)
- Dashboard shows what's actually loaded in the runtime, not what's on disk

### Claude's Discretion
- All visual/layout decisions (card vs table for list, section ordering on detail, responsive behavior)
- Error handling when agent service is unreachable (clear error state with context)
- Loading states and skeleton patterns
- Empty states (e.g., agent with no recent conversations, agent with no sub-agents)
- How to visually distinguish orchestrator agents from sub-agents
- System prompt collapsible behavior (default collapsed vs expanded, max height before scroll)

</decisions>

<specifics>
## Specific Ideas

- Follow Linear/Vercel dashboard patterns for modern, clean presentation
- The API returns 5 agents currently: dev-agent, product-agent, coder, researcher, tester
- dev-agent has sub-agents (researcher, coder, tester) and triggers; sub-agents have neither
- System prompts are the largest data field -- detail endpoint includes full prompt.md content
- List endpoint excludes systemPrompt for performance (already implemented in Phase 48)

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 52-agent-definitions-view*
*Context gathered: 2026-02-04*
