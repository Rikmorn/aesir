# Phase 72: Delegation Graph Observability - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators see delegation hierarchies, signal flows, and health indicators in the dashboard for debugging and monitoring multi-agent workflows. This adds a new "Tasks" section to the existing Next.js 15 dashboard. Data comes from the task tree, agent_events, and conversations tables built in Phases 70-71.

</domain>

<decisions>
## Implementation Decisions

### Graph Layout
- Left-to-right flow (dagre `rankdir: 'LR'`), not top-down tree
- Temporal flow matches sequential delegation chains and aligns with timeline below
- Typical graph is 3-4 nodes wide (max depth 3, sequential only in v2.7)

### Node Content
- Five fields per node: entity name (primary label), color-coded status, task summary (truncated ~50 chars), elapsed time (relative), health badge icon
- Node size: ~220px wide, ~80px tall
- Status colors: green=completed, red=failed, blue/pulsing=running, amber=waiting, gray=pending
- Health badge: warning triangle (timeout), disconnected-link icon (orphan), no badge=healthy
- Task ID, completion result, full timestamps, conversation link stay out of node surface (click-through only)

### Edge Styling
- Single edge per delegation relationship, no labels, no multiple edges between same pair
- Edge state encoded in color and line style:
  - Handshake pending: dashed gray
  - Accepted / in progress: solid blue, animated (moving dashes — key differentiator for active work)
  - Completed: solid green
  - Failed: solid red
  - Timed out: solid amber
  - Orphaned: dashed amber (not dashed red — orphan is undelivered, not broken)
- Direction always parent→child (left to right). No reverse arrows for completion signals — state encoded in color change
- Hover tooltip on edge: signal type, timestamp, one-line payload preview

### Rejected Delegation Rendering
- Rejected nodes render dimmed: gray, ~70% opacity, thin dashed gray edge
- Same dagre rank as active nodes, stacks below active path
- Minimal content: entity name + "Rejected" status
- Side panel shows rejection reason and timestamp
- Keeps rejection history visible (OBS-05) without overwhelming the active path

### Orphan Visual Treatment
- Orphan is distinct from failure (work succeeded, delivery broke)
- Green node + dashed amber edge = work done, signal stranded
- Red node + dashed amber edge = work failed, nobody knows
- Disconnected-link icon on parent node (where broken conversation is)
- Side panel shows: "Orphaned — result available but undelivered", completion_result payload inline, reason why callback failed

### Node Click Interaction
- Single click opens right-side detail panel (drawer). Graph stays visible
- Click different node → panel swaps content
- Click empty canvas or close button → panel dismisses
- No double-click, no right-click menus — one interaction mode
- Panel contents (top to bottom):
  1. Header: entity name, status badge, elapsed time
  2. Full task description
  3. Handshake detail: accepted/rejected, estimate, timestamp, rejection reason if applicable
  4. Result (terminal states only): completion_result rendered — summary + artifacts for completion, reason + partial results for failure
  5. Signals: compact list of signals sent/received for this task with timestamps
  6. "View conversation" link → navigates to existing conversation detail page

### Timeline Placement
- Below the graph, collapsible
- Default: graph takes full height, timeline collapsed (just a "Timeline" bar)
- Expanded: graph ~60% height, timeline ~40%
- Bidirectional linking: click timeline event → node highlights/pulses in graph; click graph node → timeline scrolls to and highlights that node's events

### Timeline Events
- Filtered to delegation lifecycle events only (not tool calls, LLM turns, knowledge operations)
- Event types: delegation created, conversation started, handshake response, delegator paused, nested delegation, task terminal state, signal dispatched, signal delivered/orphaned, timeout fired
- Each row: timestamp | entity icon | event description (one line)
- Color-coded by event type, same palette as edge states
- Typical chain: 8-15 events. Worst case with rejections + feedback loop: 30-40 events
- No filtering or search for v2.7 — bidirectional graph linking covers the "show me one agent's events" use case

### Live Updates
- Auto-poll at 30s (OBS-07). Graph and timeline update together
- New events fade in with brief background highlight (0.5s) — no toast, no badge counter
- Stop polling when every task in tree is terminal (completed, failed, cancelled). Resume if user navigates to in-progress tree

### Health Indicators
- Per-node: health badges on affected nodes (already part of node content)
- Per-tree: aggregate health column on task list page — "2 warnings" amber badge, "1 failure" red badge, "Clean" or empty for healthy
- Health aggregates: orphaned signal count, timeout count, rejection chain count, depth limit reached (boolean)
- Worst severity wins color: failure=red, timeout/orphan=amber, clean=no badge
- Health column empty for standalone tasks (no delegation = no delegation health issues)

### Navigation Structure
- New top-level "Tasks" nav item in dashboard sidebar
- Nav order: Conversations, Tasks (new), Agents, Tools
- `/dashboard/tasks` — root task list (tasks without parentTaskId)
- `/dashboard/tasks/:taskId` — graph view for that task's tree (deep-linkable, shareable)
- No deeper URL nesting — side panel state, selected node, timeline open/closed are client-side ephemeral state

### Task List Page
- Shows all root tasks (standalone and delegated)
- Columns: description, originating entity, status, subtasks count, health indicator, age
- Click any row → navigates to `/dashboard/tasks/:taskId` graph view
- Standalone tasks (0 subtasks) render as single-node graph with side panel auto-opened

### Cross-linking
- Conversation detail page: "View task tree" link when conversation has associated task → navigates to `/dashboard/tasks/:rootTaskId`
- Graph side panel: "View conversation" link → navigates to `/dashboard/conversations/:conversationId`
- Bidirectional: conversation → task tree → different conversation (OBS-03 cross-conversation tracing)

### Claude's Discretion
- React Flow configuration details (zoom bounds, minimap, controls)
- Exact CSS/tailwind styling, spacing, typography
- dagre layout parameters beyond `rankdir: 'LR'`
- Task list pagination strategy (offset vs cursor)
- API response shape for tree endpoints (recursive CTE optimization)
- Loading states and skeleton designs
- Error state handling for failed API calls

</decisions>

<specifics>
## Specific Ideas

- Animated edges (React Flow moving dashes) for in-progress work is the highest-value visual signal — instantly scan where work is active vs resolved
- Timeline and graph are "two projections of the same data, cross-linked" — the interaction model justifies co-locating them
- Orphaned completions should render the completion_result payload inline in the side panel — "work is done, delivery broke" is the message, and the result is right there
- Side panel pattern similar to Linear's issue detail — click opens detail, click another item swaps content
- Task list triage view with health column is the "scan 10 trees, spot the 2 that need attention" workflow

</specifics>

<deferred>
## Deferred Ideas

- Timeline filtering by entity or event type — add when parallel delegation (ASIG-02) increases event volume past ~40 per tree
- Real-time SSE updates for graph — 30s polling sufficient for v2.7 delegation chains
- URL-encoded UI state (selected node, timeline open) — ephemeral client state, not worth URL complexity
- Dagre `rankdir` toggle (LR vs TB) — add when parallel delegation creates wide fan-out trees
- "Retry delivery" button for orphaned completions — v2.7 is store-and-log only
- Active curation of health patterns (auto-alerting on repeated rejection chains) — manual dashboard scanning for v2.7

</deferred>

---

*Phase: 72-delegation-graph-observability*
*Context gathered: 2026-02-10*
