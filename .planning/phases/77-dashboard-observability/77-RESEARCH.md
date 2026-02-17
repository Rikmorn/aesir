# Phase 77: Dashboard Observability - Research

**Researched:** 2026-02-17
**Domain:** Next.js 15 dashboard UI (React 19, Tailwind CSS 4, Radix UI, Lucide icons) + agent-service event emission
**Confidence:** HIGH

## Summary

Phase 77 transforms the conversation detail timeline from a flat event list into a rich debugging interface. The work splits into two layers: (1) agent-service changes to emit missing events and wire MCP observability callbacks, and (2) dashboard rendering changes to group tool calls, attribute sub-agent work, render lifecycle banners, add filter chips, and display summary metrics.

The existing event timeline (`event-timeline.tsx`) renders every event as an identical collapsible row. The refactor replaces this with a type-aware rendering pipeline: tool calls become grouped cards, lifecycle events become thin banners, LLM responses keep their current treatment, and sub-agent events get indented with agent name pills. All new event types get a generic JSON fallback so unknown types render immediately without a dashboard deploy.

**Primary recommendation:** Start with the agent-service event emission gap (new event types + MCP `onMcpEvent` wiring) to ensure all event types exist in the database before building renderers. Then refactor `EventTimeline` into a grouping/filtering layer that delegates to specialized renderer components per event category.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Group tool events (tool.called + tool.succeeded/tool.failed) by `toolCallId` into a single expandable card
- Collapsed state: tool name + success/fail badge + duration + truncated output preview (~80 chars). Two lines per card.
- Expanded state: two collapsible sections -- **Input** (formatted JSON, collapsed by default) and **Output** (formatted JSON, collapsed by default but auto-expanded on failure)
- Duration + timestamp pinned visible when expanded so context isn't lost scrolling through payloads
- All cards collapsed by default except failures -- failures auto-expand with red left border + destructive background
- The three underlying events (called, succeeded, failed) are hidden -- grouping replaces them
- MCP error events (mcp.error, mcp.rate_limited, mcp.retries_exhausted) render inside the tool card that caused them, not as separate timeline entries. If the tool succeeded after rate-limit retries, show a subtle indicator (e.g., "succeeded after 2 retries, 1.2s backoff"). Requires toolCallId correlation in MCP event payload -- if missing, that's a gap to fix in the agent-service event emission.
- One chronological timeline -- sub-agent events indented with an agent name pill, not separate lanes or collapsible groups
- Agent name pill: small colored chip before event content (e.g., `[researcher]`). Muted background, small text, consistent color per agentDefinitionId (hash to pick from 4-6 muted palette colors)
- Single indent level only -- each conversation view only shows orchestrator + direct sub-agents. Child sub-agents run in separate conversations (click through to see)
- Sub-agent spawn (agent.started with parentInstanceId): render as "Spawned {agentId}" with task excerpt, not generic "Agent Started"
- Sub-agent complete (agent.completed with parentInstanceId): render as "{agentId} completed" with output preview. Failure gets same red treatment as failed tool cards
- Top-level agent.started/agent.completed (no parentInstanceId) keep current lifecycle treatment
- Lifecycle events (paused, resumed, reopened, stale_recovered, retry_scheduled) render as thin full-width banners, not cards
- One line: icon + label + short description from payload + timestamp
- Muted styling -- lower contrast than tool cards and LLM responses
- No collapse/expand -- the banner is the whole story
- Severity exceptions: agent.stale_recovered and agent.retry_scheduled get amber/warning treatment; notification.failed gets red/destructive treatment; everything else (paused, resumed, reopened) gets neutral/muted
- No schema/migration changes for new event types -- dashboard renders based on type string with a known-type-to-styled-renderer mapping and a generic JSON fallback for unknown types
- Generic fallback: type label + formatted JSON payload -- new event types are visible immediately without a dashboard deploy
- Row of toggle chips above the timeline: Failures | Lifecycle | Tool calls | LLM | one chip per sub-agent name (dynamic, only if sub-agents exist)
- Click to toggle on/off, multiple active at once, all on by default
- Two target workflows: "What went wrong?" (Failures only) and "What did {agent} do?" (specific sub-agent only)
- No saved filters, no text search, no time range
- Compact stats bar above the timeline, always visible, one line
- Metrics: wall-clock duration | input tokens | output tokens | tool success rate (N/M succeeded) | retry count
- No cost estimate
- Live-updating via SSE: metrics are a running accumulation from the same event stream that powers the timeline
- Use existing formatTokenCount() and formatDurationMs() from lib/format.ts
- Sort order: chronological always (oldest first)
- Active conversations: auto-scroll to bottom as new events arrive (already exists)
- Completed conversations: jump-to-end button to skip to the latest events
- Combined with filter chips (Failures only) and auto-expand on failure, this covers the "find what went wrong" workflow

### Claude's Discretion
- Exact icon choices for each event type (from design system icon set)
- Spacing between timeline items and padding within tool cards
- Agent pill color palette selection (4-6 muted colors)
- Generic fallback renderer styling for unknown event types
- Jump-to-end button placement and styling
- Filter chip visual treatment (active/inactive states)

### Deferred Ideas (OUT OF SCOPE)
- Cost estimation from token counts -- requires pricing config, model-specific rates, multi-model support. Separate feature.
- Text search within events -- forensics-level analysis belongs in logs/SQL, not dashboard
- Saved filter presets -- complexity not justified for current usage
- Time range filtering -- same as above
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | `agent.stale_recovered` event emitted on stale heartbeat recovery | **Gap found**: Event type NOT in schema, NOT emitted. Worker loop stale recovery only logs + re-enqueues. Need to: (1) add `agent.stale_recovered` to `agentEventTypeValues` in both agent schema and dashboard schema, (2) emit event in `worker-loop.ts` `recoverStaleConversations()` |
| DASH-02 | `agent.retry_scheduled` event emitted on retry decisions | **Gap found**: Event type NOT in schema, NOT emitted. Retry logic only updates conversation row. Need to: (1) add `agent.retry_scheduled` to both schemas, (2) emit event in retry logic path |
| DASH-03 | Lifecycle events render with distinct icons/colors in timeline | Existing `event-icon.tsx` has icon/color maps for core types. Extend to cover new types. Render as thin banners per locked decision. |
| DASH-04 | Tool calls grouped by `toolCallId` as expandable cards | Tool events already carry `tool_call_id` in payload (from `worker-loop.ts` onToolCall/onToolResult). Grouping logic needed in timeline component. |
| DASH-05 | Sub-agent work visually attributed with agent name labels | Events already carry `parent_instance_id` and `agent_definition_id`. Need pill component + indentation logic. |
| DASH-06 | MCP error events rendered in timeline | **Gap found**: MCP events are in the agent schema enum BUT `onMcpEvent` is NOT wired in `mcp-wrapper.ts` (production tool factory). Also MCP event payloads lack `toolCallId` for correlation. Both must be fixed in agent-service. Dashboard needs `ALL_EVENT_TYPES` expanded for SSE delivery. |
| DASH-07 | `notification.failed` event rendered prominently | Event type is in schema, IS emitted by `worker-loop.ts` `notifyFailure()`. Dashboard just needs renderer + SSE type registration. |
| DASH-08 | Summary metrics (tokens, duration, tool success rate, retry count) | Tokens already computed in `live-detail-panels.tsx`. Need to add tool success/failure counters, wall-clock duration (already exists in metadata strip), and retry count (already in conversation metadata). Consolidate into a stats bar. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.9 | App Router, RSC, API routes | Already in use |
| React | 19.x | UI framework | Already in use |
| Tailwind CSS | 4.x | Styling | Already in use |
| Radix UI | 1.4.3 | Collapsible primitive | Already in use for event timeline |
| Lucide React | 0.400.0 | Icon set | Already in use for event icons |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| class-variance-authority | 0.7.x | Badge variant styling | Agent name pills, filter chips |
| nuqs | 2.8.x | URL state management | NOT needed -- filter state is local (no saved filters) |

### No New Dependencies
This phase requires zero new package installations. All rendering is achievable with existing Tailwind classes, Radix Collapsible, Lucide icons, and the existing Badge component.

## Architecture Patterns

### Current File Structure (conversation-detail/)
```
components/conversation-detail/
  event-timeline.tsx       # EventTimeline + EventItem (the main refactor target)
  event-content.tsx        # EventContentDisplay (lazy-loaded LLM content)
  event-icon.tsx           # EventIcon (icon + color mapping)
  json-payload.tsx         # JsonPayload (formatted JSON display)
  live-detail-panels.tsx   # LiveDetailPanels (SSE wiring, metadata, auto-scroll)
  reopen-dialog.tsx        # ReopenDialog (reopen action)
```

### Recommended File Structure After Phase 77
```
components/conversation-detail/
  event-timeline.tsx           # Refactored: groups events, applies filters, delegates to renderers
  event-renderers/
    tool-call-card.tsx         # Grouped tool card (called + succeeded/failed + MCP errors)
    lifecycle-banner.tsx       # Thin banner for lifecycle events
    llm-response-row.tsx       # Extracted from current EventItem (LLM content display)
    sub-agent-pill.tsx         # Agent name pill component
    generic-event-row.tsx      # Fallback renderer for unknown event types
  event-filters.tsx            # Filter chip row component
  event-metrics-bar.tsx        # Compact stats bar
  event-content.tsx            # (unchanged)
  event-icon.tsx               # Extended with new event type mappings
  json-payload.tsx             # (unchanged)
  live-detail-panels.tsx       # Extended: filter state, metrics accumulation, jump-to-end
  reopen-dialog.tsx            # (unchanged)
```

### Pattern 1: Event Grouping Pipeline
**What:** Transform the flat event array into grouped timeline items before rendering
**When to use:** Before the EventTimeline component maps events to JSX

The core transformation:
1. Scan the flat event array
2. Group `tool.called` + `tool.succeeded`/`tool.failed` by matching `payload.tool_call_id`
3. Attach MCP error events (`mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`) to their parent tool card by matching `payload.tool_call_id`
4. Classify remaining events into categories: lifecycle, llm, sub-agent-lifecycle, signal, unknown
5. Apply active filters
6. Render each group/event with the appropriate renderer

```typescript
// Source: codebase analysis
type TimelineItem =
  | { kind: "tool_card"; called: ConversationEvent; result: ConversationEvent | null; mcpErrors: ConversationEvent[] }
  | { kind: "lifecycle_banner"; event: ConversationEvent }
  | { kind: "llm_response"; event: ConversationEvent }
  | { kind: "signal"; event: ConversationEvent }
  | { kind: "generic"; event: ConversationEvent };

function groupTimelineEvents(events: ConversationEvent[]): TimelineItem[] {
  // Build lookup by tool_call_id
  // Walk events in sequence order, grouping tool events
  // Classify everything else by type
}
```

### Pattern 2: Agent Pill Color Hashing
**What:** Deterministic color assignment for sub-agent name pills
**When to use:** When rendering events with `parentInstanceId !== null`

```typescript
// Source: design decision
const AGENT_PILL_COLORS = [
  { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20" },
  { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20" },
  { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
  { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
  { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
];

function getAgentColor(agentDefinitionId: string): typeof AGENT_PILL_COLORS[number] {
  let hash = 0;
  for (const char of agentDefinitionId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return AGENT_PILL_COLORS[Math.abs(hash) % AGENT_PILL_COLORS.length];
}
```

### Pattern 3: Filter Chip State Management
**What:** Local state for filter toggles (no URL persistence per locked decision)
**When to use:** In LiveDetailPanels, managing which categories are visible

```typescript
// Source: design decision -- all on by default, toggle individually
interface FilterState {
  failures: boolean;
  lifecycle: boolean;
  toolCalls: boolean;
  llm: boolean;
  subAgents: Record<string, boolean>; // agentDefinitionId -> visible
}

const defaultFilters: FilterState = {
  failures: true,
  lifecycle: true,
  toolCalls: true,
  llm: true,
  subAgents: {}, // dynamically populated, all true by default
};
```

### Pattern 4: Metrics Accumulation from Events
**What:** Derive summary metrics from the event array (not separate queries)
**When to use:** For the stats bar above the timeline

```typescript
// Source: existing pattern in live-detail-panels.tsx (already accumulates tokens)
interface TimelineMetrics {
  wallClockDurationMs: number;    // conversation.updatedAt - conversation.createdAt (already computed)
  tokenInput: number;              // already tracked in live-detail-panels.tsx
  tokenOutput: number;             // already tracked in live-detail-panels.tsx
  toolSuccessCount: number;        // count tool.succeeded events
  toolFailureCount: number;        // count tool.failed events
  retryCount: number;              // from conversation.retryCount (already in metadata)
}
```

### Anti-Patterns to Avoid
- **Separate database queries for metrics:** The metrics must come from the same event array that powers the timeline, not from separate DB calls. Otherwise SSE updates create inconsistency between timeline and stats.
- **Deep nesting of sub-agent events:** Only one indent level. Each conversation shows orchestrator + direct sub-agents. Deeper nesting is a separate conversation.
- **Overriding schema enum validation on SSE delivery:** The SSE endpoint validates event types against `agentEventTypeValues`. New event types must be added to the agent schema enum, otherwise SSE won't deliver them. The dashboard's `ALL_EVENT_TYPES` must also be updated.
- **Stateful filter persistence:** No URL params, no localStorage, no saved presets. Filter state is ephemeral React state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible sections | Custom show/hide | Radix Collapsible (already used) | Accessible, animated, proven in codebase |
| Icon mapping | Custom SVG imports | Lucide React (already used) | Consistent icon set, tree-shakeable |
| Badge styling | Custom CSS classes | CVA Badge variant (already used) | Consistent with design system |
| JSON formatting | Custom renderer | Existing JsonPayload component | Already handles truncation, max height |
| Token formatting | Custom logic | Existing `formatTokenCount()` from `lib/format.ts` | Already in use across dashboard |
| Duration formatting | Custom logic | Existing `formatDurationMs()` from `lib/format.ts` | Already in use across dashboard |
| Event type labels | Custom mapping | Existing `formatEventType()` from `lib/format.ts` | Handles case conversion |

**Key insight:** The dashboard already has every UI primitive needed. This phase is composition and grouping, not new infrastructure.

## Common Pitfalls

### Pitfall 1: SSE Event Type Registration Gap
**What goes wrong:** New event types are added to the agent schema (`agentEventTypeValues`) but not registered in the dashboard's `ALL_EVENT_TYPES` constant. The `EventStreamStore` only listens for types listed in `ALL_EVENT_TYPES`. Events are stored in the DB but never reach the SSE client.
**Why it happens:** Two separate type registries -- agent-service schema and dashboard SSE types -- must stay in sync manually.
**How to avoid:** When adding new event types to the agent schema, ALSO add them to `packages/dashboard/src/lib/sse-types.ts` `ALL_EVENT_TYPES` AND to `packages/dashboard/src/lib/schema.ts` `agentEventTypeValues`.
**Warning signs:** Events appear in the DB but not in the live timeline. Events only show after a full page refresh (initial server-side load works, SSE delivery doesn't).

### Pitfall 2: MCP Event Payload Missing toolCallId
**What goes wrong:** MCP error events (`mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`) are emitted without `toolCallId` in their payload. The dashboard can't correlate them to the originating tool card and must render them as standalone timeline entries, breaking the user's mental model.
**Why it happens:** The MCP client's `onMcpEvent` callback doesn't know the Anthropic `toolUse.id` -- it only knows the integration, tool name, and error details. The `toolCallId` lives in the agent loop (the `toolUse.id` from the LLM response), and must be threaded through.
**How to avoid:** Pass `toolCallId` (the Anthropic tool_use ID) through the `McpToolDeps` or `McpCallOptions` interface so `onMcpEvent` can include it in the payload. The wiring happens in `worker-loop.ts` where both `toolUse.id` and the tool execution context are available.
**Warning signs:** MCP error events render as standalone cards instead of inside tool cards.

### Pitfall 3: Tool Call Grouping with Orphaned Events
**What goes wrong:** A `tool.called` event has no matching `tool.succeeded`/`tool.failed` (e.g., conversation crashed mid-tool-execution, or events are still arriving via SSE). The grouping logic produces an incomplete card.
**Why it happens:** Tool call and result events are separate -- there's no transaction grouping in the event log.
**How to avoid:** Handle incomplete groups gracefully. A `tool.called` without a result shows as "In progress..." with a spinner or muted state. When the result arrives via SSE, the card updates in place.
**Warning signs:** Tool cards stuck in "In progress" state for completed conversations (indicates a `tool.called` was emitted but the result event was lost).

### Pitfall 4: Event Order Assumptions in Grouping
**What goes wrong:** Tool events are grouped assuming `tool.called` always precedes its matching result in the sequence. But SSE events could arrive out of order in edge cases (batch flush timing).
**Why it happens:** The event log assigns gapless sequences, but SSE delivery is per-connection and events are batched.
**How to avoid:** Group by `tool_call_id` using a Map lookup, not by sequential adjacency. Process all events first, then build grouped timeline items.
**Warning signs:** Tool results appearing as standalone events instead of inside cards.

### Pitfall 5: Dashboard Schema Drift
**What goes wrong:** New event types are added to the agent-service schema but not mirrored to the dashboard's local schema (`packages/dashboard/src/lib/schema.ts`). The dashboard uses a local copy to avoid importing the full agent package. TypeScript types work but the Drizzle enum constraint doesn't include new values.
**Why it happens:** Dashboard deliberately maintains an independent copy (documented in schema.ts header). No automated sync.
**How to avoid:** When updating `agentEventTypeValues` in `packages/agents/src/shared/db/schema.ts`, simultaneously update the mirror in `packages/dashboard/src/lib/schema.ts`.
**Warning signs:** Dashboard doesn't recognize new event types in type-safe code paths.

### Pitfall 6: Stale MCP Event Wiring
**What goes wrong:** The `mcp-wrapper.ts` `createMcpToolWrapper()` calls `callMcpTool()` but does NOT pass `onMcpEvent`. MCP observability events are silently lost.
**Why it happens:** The MCP client supports the callback, the event types are in the schema, but the production wiring was never connected. The tool factory creates `McpToolDeps` with `agentId`, `correlationId`, and `taskId` but doesn't include an event emission callback.
**How to avoid:** Wire `onMcpEvent` in `mcp-wrapper.ts` to emit events via the EventLog. This requires threading EventLog access through the tool factory context.
**Warning signs:** `mcp.error`, `mcp.rate_limited`, and `mcp.retries_exhausted` events never appear in the event log despite MCP errors occurring.

## Code Examples

### Existing Tool Event Payload Structure (from worker-loop.ts)

```typescript
// tool.called payload
{
  tool_name: "linear_get_issue",   // string
  tool_call_id: "toolu_01ABC...",  // Anthropic tool_use ID
  input: { issueId: "LIN-123" }   // Record<string, unknown>
}

// tool.succeeded payload
{
  tool_name: "linear_get_issue",
  tool_call_id: "toolu_01ABC...",
  output: "{ ... }",              // string (truncated to 2000 chars)
  is_error: false
}

// tool.failed payload
{
  tool_name: "linear_get_issue",
  tool_call_id: "toolu_01ABC...",
  output: "Tool execution error: ...",
  is_error: true
}
```

### MCP Event Payload Structure (from mcp/client.ts)

```typescript
// Current mcp.error payload (MISSING toolCallId)
{
  tool: "get_issue",        // MCP tool name (NOT the display name)
  integration: "linear",
  status: 404,
  message: "Not found"
}

// Current mcp.rate_limited payload (MISSING toolCallId)
{
  tool: "get_issue",
  integration: "linear",
  attempt: 1,
  retryAfterMs: 3000
}

// Current mcp.retries_exhausted payload (MISSING toolCallId)
{
  tool: "get_issue",
  integration: "linear",
  attempts: 3,
  totalRetryMs: 7200,
  finalStatus: 503
}
```

### notification.failed Payload (from worker-loop.ts)

```typescript
// notification.failed payload (ALREADY emitted)
{
  channel: "slack",             // reply_context.channel
  error: "Channel not found",  // error message
  conversationId: "conv_...",
  status: "failed"
}
```

### Existing Event Icon/Color Mapping (from event-icon.tsx)

```typescript
// Current icon mapping -- extend with new types
const iconMap: Record<string, LucideIcon> = {
  "agent.started": PlayCircle,
  "agent.completed": CheckCircle,
  "agent.paused": PauseCircle,
  "agent.resumed": PlayCircle,
  "agent.reopened": RotateCcw,
  "tool.called": Zap,
  "tool.succeeded": CheckCircle,
  "tool.failed": XCircle,
  "llm.response": MessageCircle,
  "signal.received": Zap,
};
```

### SSE Type Registration (from sse-types.ts)

```typescript
// CURRENT -- missing many event types
export const ALL_EVENT_TYPES = [
  "tool.called",
  "tool.succeeded",
  "tool.failed",
  "llm.response",
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
  "signal.received",
] as const;

// AFTER Phase 77 -- must include ALL renderable event types
export const ALL_EVENT_TYPES = [
  "tool.called",
  "tool.succeeded",
  "tool.failed",
  "llm.response",
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
  "agent.reopened",
  "agent.stale_recovered",
  "agent.retry_scheduled",
  "signal.received",
  "signal.orphaned",
  "mcp.error",
  "mcp.rate_limited",
  "mcp.retries_exhausted",
  "notification.failed",
] as const;
```

### ConversationEvent Interface (from services/conversations.ts)

```typescript
// The dashboard's event shape -- all fields already available
export interface ConversationEvent {
  id: string;
  conversationId: string;
  agentDefinitionId: string;
  agentInstanceId: string;
  parentInstanceId: string | null;   // Key for sub-agent detection
  sequence: number;
  type: string;                      // NOT typed to enum -- allows unknown types
  payload: Record<string, unknown>;  // Contains tool_call_id for tool events
  timestamp: Date;
  tokenCountInput: number | null;
  tokenCountOutput: number | null;
  durationMs: number | null;
}
```

## Key Gaps Found (Agent-Service Work Required)

### Gap 1: Missing Event Types in Schema
**Status:** `agent.stale_recovered` and `agent.retry_scheduled` do NOT exist in `agentEventTypeValues`
**Location:** `packages/agents/src/shared/db/schema.ts` line 142-158
**Action:** Add both to the enum array. No migration needed -- the column uses TEXT type with a CHECK constraint that must be updated via migration OR the type column uses text without enum constraint (needs verification).

### Gap 2: Missing Event Emission in Worker Loop
**Status:** Stale recovery and retry scheduling only log, never emit events
**Stale recovery location:** `packages/agents/src/framework/worker-loop.ts` lines 767-819 (re-enqueue only updates conversation row + logs)
**Retry location:** Error handling in `executeConversation()` where retry_count is incremented
**Action:** Add `eventLog.append()` calls for both codepaths

### Gap 3: MCP onMcpEvent Not Wired
**Status:** `createMcpToolWrapper()` in `mcp-wrapper.ts` calls `callMcpTool()` WITHOUT `onMcpEvent`
**Location:** `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` line 76-83
**Action:** Thread `onMcpEvent` through `McpToolDeps` -> `createMcpToolWrapper` -> `callMcpTool`. The callback should append events to the EventLog. This requires EventLog access in the tool factory context, which must be threaded through `ToolContext`.

### Gap 4: MCP Events Missing toolCallId
**Status:** MCP event payloads have no `toolCallId` field. The MCP client doesn't know the Anthropic tool_use ID.
**Location:** `packages/agents/src/shared/mcp/types.ts` `McpCallOptions` interface
**Action:** Add `toolCallId` to `McpCallOptions` (optional). Pass it through from the `onToolCall` context in `worker-loop.ts` (which has `toolUse.id`). Include in all MCP event payloads.

### Gap 5: Dashboard SSE Type Registration
**Status:** `ALL_EVENT_TYPES` in `sse-types.ts` missing 8 event types. `EventStreamStore` only registers listeners for types in this array.
**Location:** `packages/dashboard/src/lib/sse-types.ts` lines 62-72
**Action:** Add all new event types to `ALL_EVENT_TYPES` and mirror in dashboard schema.

### Gap 6: Dashboard Schema Event Type Enum
**Status:** Dashboard's local `agentEventTypeValues` in `schema.ts` is missing the new event types added in Phase 76
**Location:** `packages/dashboard/src/lib/schema.ts` lines 62-75
**Action:** Add `mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`, `notification.failed`, `agent.stale_recovered`, `agent.retry_scheduled` to the dashboard schema enum. Also add `agent.reopened` which exists in agent schema but is already in dashboard schema.

### Gap 7: Event Type Column Constraint
**Status:** The `type` column in `agent_events` uses a Drizzle `text("type", { enum: agentEventTypeValues })` -- this may or may not create a CHECK constraint depending on migration history
**Action:** Verify whether adding new values to the TypeScript enum requires a database migration. If the DB has a CHECK constraint, a migration is needed to alter it. If it's plain TEXT (as the `type: text` column type suggests with enum as TypeScript-only validation), no migration is needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat event list with identical collapsible rows | Grouped timeline items with type-specific renderers | Phase 77 | Every event type gets appropriate visual treatment |
| MCP errors invisible (logged only) | MCP errors in event log + rendered in tool cards | Phase 76 (emission) + Phase 77 (rendering) | Full MCP error visibility |
| Stale recovery invisible (logged only) | Stale recovery as timeline event | Phase 77 | Crash recovery is visible in the timeline |

## Open Questions

1. **Database CHECK constraint on type column**
   - What we know: Drizzle's `text("type", { enum: [...] })` generates a CHECK constraint in some configurations but not others. The agents schema uses `text()` with an enum option.
   - What's unclear: Whether adding new enum values requires a DB migration or just a TypeScript-level change.
   - Recommendation: Check the actual migration files to see if a CHECK constraint was created. If yes, generate a migration to add the new values. If no, only TypeScript changes are needed. Either way, this is a quick investigation at plan execution time.

2. **MCP onMcpEvent wiring path through ToolContext**
   - What we know: The `ToolContext` interface provides `agentId`, `correlationId`, `logger`, but NOT `eventLog`. The MCP wrapper needs to emit events but currently has no access to the EventLog.
   - What's unclear: Best wiring path -- should EventLog be added to ToolContext, or should the tool factory return events that the caller (worker loop) emits?
   - Recommendation: Add an optional `onMcpEvent` callback to `ToolContext` (similar to how `spawnDeps` and `delegationDeps` are optional). The worker loop creates the callback closure with EventLog access. The MCP wrapper passes it through to `callMcpTool`. This avoids giving every tool direct EventLog access.

3. **toolCallId threading for MCP events**
   - What we know: The `onToolCall` callback in worker-loop.ts has access to `toolUse.id` (the Anthropic tool_use ID). The tool's `execute()` method calls `callMcpTool()`. But `execute()` doesn't receive `toolCallId` -- it only gets `input`.
   - What's unclear: How to thread `toolCallId` from the agent loop to the MCP call without changing the `ToolDefinition.execute()` signature.
   - Recommendation: Two options: (a) Add `toolCallId` to `McpToolDeps` and set it before each call (but `McpToolDeps` is created once at tool resolve time, not per-call). (b) Use the `onMcpEvent` callback closure in `ToolContext` which is created by the worker loop with access to the current `toolUse.id` via the `onToolCall` callback context. Option (b) is more natural -- the worker loop wraps the callback to include the current toolCallId.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/dashboard/src/` -- all conversation-detail components, services, SSE infrastructure, design system
- Codebase analysis: `packages/agents/src/framework/` -- event-log.ts, worker-loop.ts, types.ts, conversation-executor.ts
- Codebase analysis: `packages/agents/src/shared/mcp/` -- client.ts, types.ts
- Codebase analysis: `packages/agents/src/shared/agent-loop/` -- run-agent-loop.ts, types.ts
- Codebase analysis: `packages/agents/src/service/api/sse-events.ts` -- SSE event delivery
- v2.8 spec: `.planning/specs/2.8-agent-resilience.md` -- Phase 4 requirements and gap analysis

### Secondary (MEDIUM confidence)
- Design system: `.interface-design/system.md` -- color tokens, spacing, typography, depth strategy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries verified in package.json
- Architecture: HIGH -- all existing code read, patterns derived from actual implementation
- Pitfalls: HIGH -- identified from direct code analysis (SSE type registration, MCP wiring gaps, schema sync)
- Agent-service gaps: HIGH -- verified by searching for event types and wiring paths across the entire codebase

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable -- internal dashboard, no external API dependencies)
