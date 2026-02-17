---
phase: 77-dashboard-observability
verified: 2026-02-17T21:30:00Z
status: human_needed
score: 6/6 must-haves verified
human_verification:
  - test: "Open a conversation with sub-agent delegation and confirm sub-agent events are visually indented with colored name pills and labeled 'Spawned {agentId}' / '{agentId} completed'"
    expected: "Sub-agent lifecycle events appear with ml-6 indentation, a colored SubAgentPill before the event content, and appropriate labels — visually distinct from orchestrator events at a glance"
    why_human: "Visual hierarchy and color distinction cannot be verified programmatically; requires browser rendering"
  - test: "Open a conversation with tool calls and confirm tool events are grouped into expandable cards (not shown as 3 separate rows). Expand a card and verify collapsible Input/Output JSON sections"
    expected: "Each tool call appears as a single row. Clicking expands the card to show collapsible Input and Output sections with formatted JSON"
    why_human: "Collapsible expand/collapse behavior and JSON formatting presentation require interactive browser verification"
  - test: "On a conversation with a failed tool call, verify the tool card auto-expands with red left border and destructive background"
    expected: "Failed tool cards are already open when the page loads, with a red left border (border-l-2 border-l-destructive) and subtle red background (bg-destructive/5)"
    why_human: "Auto-expand behavior and visual failure styling require browser verification"
  - test: "Turn off all filter chips except 'Failures' and verify only failed tool cards and error lifecycle events remain visible"
    expected: "Timeline collapses to show only failed tool cards, notification.failed banners, agent.retry_scheduled banners, and exhausted agent.stale_recovered banners"
    why_human: "Filter toggling interaction and resulting visibility state require browser verification"
  - test: "On a long completed conversation (>20 events), verify the 'Jump to end' button appears and scrolls the timeline to the most recent event"
    expected: "A 'Jump to end' button appears in the timeline header. Clicking it scrolls the event list to the bottom"
    why_human: "Scroll behavior requires browser verification"
---

# Phase 77: Dashboard Observability Verification Report

**Phase Goal:** The conversation timeline renders every lifecycle event, groups tool calls into expandable cards, and attributes sub-agent work visually
**Verified:** 2026-02-17T21:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All 6 observable truths mapped to the phase success criteria are verified in the codebase. Human verification is needed for visual and interactive behavior.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Lifecycle events (started, paused, resumed, reopened, stale recovery, retry) render with distinct icons and colors | VERIFIED | `event-icon.tsx` maps all 17 event types with distinct Lucide icons and color classes; `LifecycleBanner` applies severity-based background/border styling per event type |
| 2 | Tool calls are grouped by toolCallId as expandable cards showing tool name, duration, and collapsible input/output | VERIFIED | `groupTimelineEvents()` in `event-timeline.tsx` builds `toolCalledMap`, `toolResultMap`, `mcpErrorMap` by toolCallId; `ToolCallCard` (308 lines) renders with `Collapsible`, `truncateOutput`, duration calculation, and `McpErrorsSection` |
| 3 | Sub-agent work is visually attributed with agent name labels and indented/nested blocks | VERIFIED | `SubAgentPill` (72 lines) with `hashAgentId` for deterministic color; `SubAgentLifecycleRow` uses `ml-6` indent + pill + "Spawned"/"completed" labels; `parentInstanceId` used to classify `sub_agent_lifecycle` kind in grouping |
| 4 | MCP error events render inside the associated tool card; notification.failed renders as lifecycle banner | VERIFIED | `groupTimelineEvents` indexes `mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted` into `mcpErrorMap` by toolCallId; `ToolCallCard` renders `McpErrorsSection`; `notification.failed` classified as `lifecycle_banner` in grouping pipeline and rendered by `LifecycleBanner` with destructive styling |
| 5 | Conversation detail shows summary metrics: total tokens, wall-clock duration, tool call count/success rate, retry count | VERIFIED | `EventMetricsBar` renders `wallClockDuration`, `tokenInput`/`tokenOutput` (via `formatTokenCount`), `toolSuccessCount`/`toolTotalCount`, `retryCount`; all values derived from live SSE event stream in `live-detail-panels.tsx` |
| 6 | Timeline filter chips allow filtering by category (Failures, Lifecycle, Tool calls, LLM) and by sub-agent name | VERIFIED | `EventFilters` renders Failures/Lifecycle/Tool calls/LLM static chips plus dynamic sub-agent chips from `subAgentIds`; `shouldShowItem()` implements additive Failures filter logic; filter state wired through `live-detail-panels.tsx` to `EventTimeline` |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Lines | Status | Details |
|----------|----------|-------|--------|---------|
| `packages/agents/src/shared/db/schema.ts` | 17 event types in agentEventTypeValues | — | VERIFIED | Contains all 17: tool.called through agent.retry_scheduled |
| `packages/agents/src/framework/worker-loop.ts` | Emits agent.stale_recovered (2 paths) and agent.retry_scheduled (2 paths) | — | VERIFIED | Lines 793, 841 (stale recovery); lines 1823, 1920 (retry scheduling); all wrapped in try/catch |
| `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` | onMcpEvent wired with toolCallId | — | VERIFIED | `McpToolDeps` has `onMcpEvent?` and `toolCallId?`; passed to `callMcpTool` at line 91-92 |
| `packages/agents/src/service/api/sse-events.ts` | SSE payload includes agentInstanceId and parentInstanceId | — | VERIFIED | Lines 112-113: `agentInstanceId: event.agent_instance_id`, `parentInstanceId: event.parent_instance_id` |
| `packages/dashboard/src/lib/schema.ts` | 17 event types matching agent-service | — | VERIFIED | `agentEventTypeValues` has all 17 types including `agent.stale_recovered` and `agent.retry_scheduled` |
| `packages/dashboard/src/lib/sse-types.ts` | ALL_EVENT_TYPES has 17 types; SseEvent has agentInstanceId/parentInstanceId | — | VERIFIED | 17 types confirmed; `SseEvent` interface has both fields at lines 29-30 |
| `packages/dashboard/src/components/conversation-detail/event-icon.tsx` | Icon+color for all 17 event types | — | VERIFIED | `iconMap` and `colorMap` cover all 17 types including notification.failed, stale_recovered, retry_scheduled, and all MCP types |
| `packages/dashboard/src/components/conversation-detail/event-renderers/tool-call-card.tsx` | Grouped tool call card | 308 | VERIFIED | Full implementation: `Collapsible`, `truncateOutput`, `getDuration`, `McpErrorsSection`, three states (success/failure/in-progress) |
| `packages/dashboard/src/components/conversation-detail/event-timeline.tsx` | groupTimelineEvents pipeline | — | VERIFIED | `groupTimelineEvents()` exported at line 51; `shouldShowItem()`, `isFailureItem()`, `applyFilters` via `useMemo`; imports ToolCallCard, LifecycleBanner, SubAgentPill, GenericEventRow |
| `packages/dashboard/src/components/conversation-detail/event-renderers/lifecycle-banner.tsx` | Lifecycle banner component | 103 | VERIFIED | `SEVERITY_MAP` for amber/red/neutral; `getLifecycleDescription()` extracts human-readable text from payload; uses `EventIcon` |
| `packages/dashboard/src/components/conversation-detail/event-renderers/sub-agent-pill.tsx` | SubAgentPill with deterministic color hashing | 72 | VERIFIED | `AGENT_PILL_COLORS` palette, `hashAgentId()` function; exports both for use in filter chips |
| `packages/dashboard/src/components/conversation-detail/event-renderers/generic-event-row.tsx` | Generic fallback renderer | 44 | VERIFIED | Renders type label + `JsonPayload` for any unknown event type |
| `packages/dashboard/src/components/conversation-detail/event-filters.tsx` | Filter chip row | 137 | VERIFIED | `FilterState` + `DEFAULT_FILTER_STATE` exported; static + dynamic sub-agent chips; `FilterChip` internal component |
| `packages/dashboard/src/components/conversation-detail/event-metrics-bar.tsx` | Metrics bar | 64 | VERIFIED | Renders wall-clock duration, tokens in/out, tool success rate (amber when partial), retry count |
| `packages/dashboard/src/components/conversation-detail/live-detail-panels.tsx` | LiveDetailPanels with full wiring | — | VERIFIED | `EventFilters` at line 586, `EventMetricsBar` at line 574; filter state with `useState(DEFAULT_FILTER_STATE)`; metrics derived from SSE events; `subAgentIds` derived from `parentInstanceId`; jump-to-end button at line 565 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `worker-loop.ts` | `event-log.ts` | `eventLog.append()` for stale_recovered and retry_scheduled | VERIFIED | Pattern `agent\.stale_recovered` found at lines 793, 841 in worker-loop.ts; `agent\.retry_scheduled` at lines 1823, 1920 |
| `mcp-wrapper.ts` | `mcp/client.ts` | onMcpEvent callback threaded to callMcpTool | VERIFIED | `onMcpEvent` in `McpToolDeps`; passed at lines 91-92 in mcp-wrapper.ts; `toolCallId` in all 6 `onMcpEvent` payloads in client.ts |
| `sse-types.ts` | `event-stream-store.ts` | ALL_EVENT_TYPES used for addEventListener registration | VERIFIED | `event-stream-store.ts` imports `ALL_EVENT_TYPES` at line 22; iterates at line 106 |
| `sse-types.ts` | `live-detail-panels.tsx` | SseEvent interface mapped via sseEventToConversationEvent | VERIFIED | `sseEventToConversationEvent()` at line 669 maps `agentInstanceId` and `parentInstanceId` from SSE |
| `event-timeline.tsx` | `event-renderers/tool-call-card.tsx` | EventTimeline renders ToolCallCard for tool_card items | VERIFIED | `ToolCallCard` imported at line 25; rendered in switch case at lines 255-262 |
| `event-timeline.tsx` | `event-renderers/lifecycle-banner.tsx` | EventTimeline renders LifecycleBanner for lifecycle_banner items | VERIFIED | `LifecycleBanner` imported at line 23; rendered at lines 275, 287 |
| `event-timeline.tsx` | `event-renderers/sub-agent-pill.tsx` | SubAgentPill rendered before event content for sub-agent events | VERIFIED | `SubAgentPill` imported at line 24; rendered at line 328 inside `SubAgentLifecycleRow` |
| `live-detail-panels.tsx` | `event-filters.tsx` | Filter state managed in LiveDetailPanels, passed to EventFilters | VERIFIED | `EventFilters` imported at line 41; rendered at line 586 with `filters={filters}` and `onFiltersChange={setFilters}` |
| `live-detail-panels.tsx` | `event-metrics-bar.tsx` | Metrics derived from events, passed to EventMetricsBar | VERIFIED | `EventMetricsBar` imported at line 44; rendered at line 574 with derived props from `toolMetrics` useMemo and `elapsedLabel` |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DASH-01 | 77-01 | `agent.stale_recovered` emitted on stale heartbeat recovery | SATISFIED | worker-loop.ts emits at lines 793, 841 with workerId, staleDurationMs, retryCount payload |
| DASH-02 | 77-01 | `agent.retry_scheduled` emitted on retry decisions | SATISFIED | worker-loop.ts emits at lines 1823, 1920 with retryCount, errorContext, reason payload |
| DASH-03 | 77-02, 77-04 | Lifecycle events render with distinct icons and colors | SATISFIED | event-icon.tsx maps all 17 types; LifecycleBanner applies severity styling per type |
| DASH-04 | 77-03 | Tool calls grouped by toolCallId as expandable cards | SATISFIED | groupTimelineEvents + ToolCallCard with Collapsible, duration, collapsible Input/Output |
| DASH-05 | 77-02, 77-04 | Sub-agent work visually attributed with agent name labels and indented blocks | SATISFIED | SubAgentPill + SubAgentLifecycleRow + ml-6 indentation; parentInstanceId used for classification |
| DASH-06 | 77-01, 77-03 | MCP error events rendered in timeline | SATISFIED | mcp.error/rate_limited/retries_exhausted grouped into tool cards by toolCallId; orphaned MCP errors render as lifecycle banners |
| DASH-07 | 77-02, 77-04 | notification.failed rendered prominently | SATISFIED | LifecycleBanner with destructive styling (bg-destructive/5, border-destructive/20) for notification.failed |
| DASH-08 | 77-05 | Conversation detail shows summary metrics | PARTIAL | EventMetricsBar shows total tokens, wall-clock duration, tool success rate, retry count. **Cost estimate omitted** — REQUIREMENTS.md includes it but phase success criteria and all plans omit it; this is a known scope reduction. |

**Note on DASH-08 partial:** REQUIREMENTS.md defines DASH-08 as including "cost estimate" but neither the phase success criteria (provided as the verification contract) nor any of the 5 plans mention cost estimate. The phase success criteria take priority as the contract — cost estimate is out of scope for Phase 77.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `event-renderers/tool-call-card.tsx` | 58 | `return null` | Info | Legitimate: `getDuration()` returns null when result is absent (in-progress tool call) |
| `event-renderers/tool-call-card.tsx` | 141 | `return null` | Info | Legitimate: `McpErrorsSection` returns null when `errors.length === 0` (nothing to render) |

No blockers or warnings found. Both `return null` occurrences are intentional conditional rendering guards, not stubs.

### Human Verification Required

#### 1. Sub-agent visual attribution

**Test:** Open the dashboard for a conversation that involved sub-agent delegation (e.g., a conversation where dev-agent spawned the coder sub-agent). Inspect the event timeline.
**Expected:** Sub-agent events (agent.started, agent.completed with parentInstanceId) appear with `ml-6` indentation, a colored `SubAgentPill` showing the agent name, and labels "Spawned {agentId}" or "{agentId} completed". These are visually distinct from orchestrator events at a glance.
**Why human:** Visual hierarchy and color distinction require browser rendering to evaluate.

#### 2. Tool call card expand/collapse behavior

**Test:** Open a conversation with tool calls. Verify each tool call appears as a single collapsible row (not 3 separate rows). Click a card to expand it.
**Expected:** Single row per tool call in collapsed state showing tool name, success/fail badge, duration, and truncated output. Expanded state reveals two collapsible `<details>` sections: "Input" (collapsed by default) and "Output" (collapsed by default). JSON is formatted and readable.
**Why human:** Collapsible expand/collapse behavior, JSON formatting presentation, and the visual grouping of previously separate event rows require interactive browser verification.

#### 3. Failed tool card auto-expansion

**Test:** Load a conversation where at least one tool call failed.
**Expected:** Failed tool cards are already expanded when the page loads (auto-expand on failure). They show a red left border and subtle red background distinguishing them from successful cards.
**Why human:** Auto-expand default state and destructive visual styling require browser verification.

#### 4. Failures-only filter workflow

**Test:** In the filter chip row, click to deactivate "Lifecycle", "Tool calls", and "LLM" chips, leaving only "Failures" active.
**Expected:** The timeline collapses to show only: failed tool cards, notification.failed lifecycle banners, agent.retry_scheduled banners, and any agent.stale_recovered banners with `exhausted: true`. Successful tool calls, LLM responses, and non-error lifecycle events are hidden.
**Why human:** Interactive filter toggling and the resulting visible/hidden states require browser interaction to verify.

#### 5. Jump-to-end button

**Test:** Open a completed conversation with more than 20 events. Scroll to the middle of the timeline.
**Expected:** A "Jump to end" button is visible in the timeline header. Clicking it scrolls the event list to the bottom (most recent event).
**Why human:** Scroll behavior and button state (only appears for isTerminal conversations with >20 events) require browser verification.

### Gaps Summary

No code gaps found. All required artifacts exist, are substantive (not stubs), and are properly wired. Both typechecks pass (`@aesir/agents` and `@aesir/dashboard`).

The only open items are human verification tasks for visual appearance and interactive behavior — standard UI verification that cannot be assessed via file inspection.

---

_Verified: 2026-02-17T21:30:00Z_
_Verifier: Claude (gsd-verifier)_
