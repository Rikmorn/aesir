---
phase: 55-real-time-updates
plan: 03
subsystem: dashboard-conversation-detail-live
tags: [sse, real-time, conversation-detail, auto-scroll, event-timeline, react-hooks]
dependency-graph:
  requires:
    - "55-01 (SSE client infrastructure)"
  provides:
    - "LiveDetailPanels client wrapper with SSE-powered live updates"
    - "Per-conversation SSE streaming for event timeline"
    - "Smart auto-scroll with new events pill"
    - "Metadata sidebar live status updates"
  affects:
    - "Future conversation detail enhancements"
tech-stack:
  added: []
  patterns:
    - "Serialized types for RSC server/client boundary"
    - "useMemo deserialization of Date strings"
    - "SSE event deduplication via Set"
    - "useRef-based scroll position tracking"
key-files:
  created:
    - packages/dashboard/src/components/conversation-detail/live-detail-panels.tsx
  modified:
    - packages/dashboard/src/app/conversations/[id]/page.tsx
    - packages/dashboard/src/lib/event-stream-store.ts
decisions:
  - "Serialized type interfaces (string dates) as explicit props boundary between server and client components"
  - "SseEvent to ConversationEvent mapping with empty agentInstanceId (not available in SSE payload)"
  - "Smart auto-scroll with 100px threshold and sticky new-events pill"
  - "Messages panel shows info banner during active conversation, auto-refreshes on completion"
  - "Gap detection triggers router.refresh() for full server data reload"
metrics:
  duration: "~13 minutes"
  completed: "2026-02-04"
---

# Phase 55 Plan 03: Conversation Detail Live Updates Summary

**One-liner:** LiveDetailPanels client wrapper with per-conversation SSE streaming, smart auto-scroll, 1000-event buffer cap, and live metadata sidebar updates.

## What Was Built

### LiveDetailPanels (`components/conversation-detail/live-detail-panels.tsx`, 388 lines)

**Serialized Types:**
- `SerializedConversationDetail`, `SerializedConversationEvent`, `SerializedChildConversation` -- explicit interfaces where Date fields are strings, used as props for the RSC server/client boundary
- Deserialization helpers (`deserializeConversation`, `deserializeEvent`, `deserializeChild`) convert ISO strings back to Date objects via `useMemo`

**SSE Connection:**
- Uses `useEventStream` hook with `conversationId` filter for per-conversation event streaming
- `enabled` flag tied to `conversationMeta.status === "running" || "waiting"` -- SSE only active for running/waiting conversations
- `maxEvents: 1000` buffer cap passed to the store

**Event Merging:**
- SSE events converted to `ConversationEvent` format via `sseEventToConversationEvent()`
- Deduplication via `Set<string>` of existing event IDs before merging
- Events appended chronologically, capped at 1000 with oldest-drop
- `truncatedCount` state tracks how many events were dropped for UI display

**Metadata Updates:**
- `agent.completed` SSE event sets status to "completed", updates timestamp
- `agent.paused` sets status to "waiting"
- `agent.resumed` sets status to "running"
- `llm.response` events update `lastEventAt` timestamp

**Smart Auto-Scroll:**
- `useRef` for timeline scroll container, tracks scroll position via `onScroll`
- "At bottom" detection: `scrollHeight - scrollTop - clientHeight < 100px`
- When at bottom and new events arrive: auto-scroll via `scrollIntoView({ behavior: "smooth" })`
- When scrolled up: increment `newEventsSinceScroll` counter
- Sticky "N new events" pill with click-to-scroll-to-bottom

**Gap Handling:**
- When `hasGap` flag from SSE store is true, triggers `router.refresh()` for full data reload

**Messages Panel:**
- Shows info banner "Conversation is active. Messages will update when the conversation completes." during active SSE
- Auto-calls `router.refresh()` when `agent.completed` event arrives

**Truncation Indicator:**
- Amber banner at top of timeline when events have been truncated
- Shows count and instructs user to refresh for full history

**Connection Status:**
- `ConnectionStatusIndicator` rendered in header area for active conversations only

### Updated Page (`app/conversations/[id]/page.tsx`)
- Replaced `DetailLayout` with `LiveDetailPanels`
- Server-side Date serialization via `toISOString()` for all Date fields
- Removed direct imports of `EventTimeline`, `MessagePanel`, `MetadataSidebar`, `DetailLayout`
- Page remains async server component -- all data fetching unchanged

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Explicit serialized type interfaces (not just `as any`) | Type safety at the RSC boundary; catches serialization mismatches at compile time |
| Empty string for `agentInstanceId` in SSE-to-ConversationEvent mapping | SSE payload lacks instance IDs; empty string avoids null checks in EventTimeline |
| 100px scroll threshold for "at bottom" detection | Standard UX convention; prevents false negatives from sub-pixel scroll rounding |
| Info banner for messages (not live message reconstruction) | SSE events don't contain full Anthropic message format; reconstruction would be fragile |
| `router.refresh()` on gap and completion | Server data is authoritative; full refresh is simpler and more reliable than partial reconstruction |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed .js import extension in event-stream-store.ts**
- **Found during:** Task 1 (commit verification)
- **Issue:** `event-stream-store.ts` imported `./sse-types.js` which fails in Next.js webpack (not Node.js ESM resolution)
- **Fix:** Changed to `./sse-types` (extensionless, standard Next.js convention)
- **Files modified:** `packages/dashboard/src/lib/event-stream-store.ts`
- **Commit:** 4995bf6 (included in Task 1 commit)

**2. [Parallel Plan Overlap] Task 2 page.tsx changes landed in 55-04's commit**
- **Found during:** Task 2 (commit attempt)
- **Issue:** The 55-04 parallel plan's `git add` inadvertently picked up the modified `conversations/[id]/page.tsx` from the working tree
- **Impact:** Task 2 changes are in commit `9d34b1d` (55-04) instead of a separate 55-03 commit
- **Resolution:** Changes are correct and complete; just attributed to wrong plan commit

## Verification Results

- `pnpm --filter @aesir/dashboard run typecheck` -- zero errors
- `pnpm run lint` (biome check) -- zero errors, 439 files checked
- `"use client"` present in live-detail-panels.tsx
- `useEventStream` used with conversationId filter
- `maxEvents: MAX_EVENTS` (1000) passed to hook
- `EventTimeline` receives combined server + SSE events
- `toISOString()` serialization on all Date fields in page.tsx
- `LiveDetailPanels` imported and used in page.tsx

## Next Phase Readiness

All 4 plans in Phase 55 (Real-Time Updates) are now complete:
- 55-01: SSE client infrastructure (store, hook, proxy, status indicator)
- 55-02: Conversations list live updates
- 55-03: Conversation detail live updates (this plan)
- 55-04: System overview live updates

No blockers identified. The dashboard now has real-time SSE updates across all three main views.
