---
phase: 55-real-time-updates
plan: 01
subsystem: dashboard-sse
tags: [sse, eventsource, react-hooks, real-time, useSyncExternalStore]
dependency-graph:
  requires:
    - "48-02 (agent-service SSE endpoint)"
    - "49-01 (dashboard infrastructure)"
  provides:
    - "EventStreamStore class for SSE connection management"
    - "useEventStream React hook for component consumption"
    - "SSE proxy API route at /dashboard/api/sse/events"
    - "ConnectionStatusIndicator UI component"
    - "SseEvent types and event type constants"
  affects:
    - "55-02 (conversations list live updates)"
    - "55-03 (conversation detail live updates)"
    - "55-04 (system overview live updates)"
tech-stack:
  added: []
  patterns:
    - "useSyncExternalStore for external SSE store"
    - "500ms batched event buffering"
    - "Next.js API route SSE proxy"
    - "Named SSE event listeners"
key-files:
  created:
    - packages/dashboard/src/lib/sse-types.ts
    - packages/dashboard/src/lib/event-stream-store.ts
    - packages/dashboard/src/hooks/use-event-stream.ts
    - packages/dashboard/src/app/api/sse/events/route.ts
    - packages/dashboard/src/components/ui/connection-status.tsx
  modified: []
decisions:
  - "EventStreamStore as plain class (not React component) for server/client import safety"
  - "Named event listeners for all SSE event types (not onmessage) matching server protocol"
  - "500ms setInterval flush timer for batched React state updates"
  - "1000-event cap with oldest-drop on overflow"
  - "Gap event sets hasGap flag for consumer refetch trigger"
  - "lastEventId forwarded via query param on initial connection for proxy compatibility"
  - "AbortError from client disconnect returns 499 (not 502) in proxy route"
metrics:
  duration: "~4 minutes"
  completed: "2026-02-04"
---

# Phase 55 Plan 01: SSE Client Infrastructure Summary

**One-liner:** EventStreamStore with 500ms batching, useEventStream hook via useSyncExternalStore, Next.js SSE proxy route, and ConnectionStatus indicator -- zero new dependencies.

## What Was Built

### SSE Types (`lib/sse-types.ts`, 72 lines)
- `SseEvent` interface matching agent-service `buildEventPayload()` output (camelCase fields)
- `ConnectionStatus` type with 4 states: connecting, connected, disconnected, error
- `EventStreamState` interface with events array, status, lastEventId, and hasGap flag
- `LIFECYCLE_EVENT_TYPES` constant (4 types for list/overview pages)
- `ALL_EVENT_TYPES` constant (9 types for conversation detail page)

### EventStreamStore (`lib/event-stream-store.ts`, 217 lines)
- Plain TypeScript class implementing `subscribe`/`getSnapshot` for `useSyncExternalStore`
- EventSource connection lifecycle management (connect/disconnect)
- 500ms batched event buffering with `setInterval` flush timer
- Named event listeners for all 9 SSE event types (server sends `event: tool.called`, etc.)
- Special `gap` event listener that sets `hasGap` flag for consumer-triggered refetch
- `lastEventId` tracking from SSE event IDs for reconnection replay
- 1000-event cap with oldest-event dropping on overflow
- `clearEvents()` and `clearGap()` methods for navigation/refetch handling
- Cached state reference -- `getSnapshot()` returns same object unless state changed (prevents infinite re-renders)
- Safe to import from server (no browser globals at module level)

### useEventStream Hook (`hooks/use-event-stream.ts`, 102 lines)
- `"use client"` directive for Next.js client component boundary
- Accepts options: url, types, conversationId, enabled, batchIntervalMs, maxEvents
- Builds SSE URL with query params via `useMemo` (stable across renders)
- Creates `EventStreamStore` instance via `useMemo` keyed on `[sseUrl, batchIntervalMs, maxEvents]`
- Connects/disconnects in `useEffect` based on `enabled` flag with cleanup
- Returns state via `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`
- Server snapshot returns disconnected/empty state for SSR compatibility
- Serializes types array to stable string key to prevent unnecessary store recreation

### SSE Proxy API Route (`app/api/sse/events/route.ts`, 84 lines)
- `force-dynamic` export for dynamic rendering
- Proxies browser EventSource requests to `AGENT_SERVICE_URL/api/sse/events`
- Forwards all query params (types, conversationId) to upstream
- Forwards `Last-Event-ID` header for reconnection replay
- Also accepts `lastEventId` query param for initial connections with stored ID
- Ties proxy to client connection via `request.signal` (client disconnect aborts upstream)
- Sets proper SSE headers: `text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`
- Error handling: 502 for upstream unavailable, 499 for client abort, passthrough for upstream errors

### ConnectionStatusIndicator (`components/ui/connection-status.tsx`, 50 lines)
- `"use client"` directive
- Accepts `ConnectionStatus` prop from sse-types
- Green pulsing dot + "Live" text when connected (`bg-emerald-500 animate-pulse`)
- Yellow dot + "Reconnecting..." when connecting or error (`bg-amber-500`)
- Gray dot + "Offline" when disconnected (`bg-gray-400`)
- Tailwind-only styling, no animation library

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Plain TypeScript class (not React hook internals) for EventStreamStore | Enables server-safe imports, testable without React, clean separation of concerns |
| Named event listeners instead of `onmessage` | Server sends `event: tool.called` etc. -- named events don't fire `onmessage`, only specific listeners |
| 500ms `setInterval` flush (not debounce/requestAnimationFrame) | Consistent batching cadence regardless of event arrival pattern; simpler than debounce |
| Query param forwarding for lastEventId on initial connection | Native EventSource only sends `Last-Event-ID` header on reconnect, not initial connect; proxy needs it via query param |
| 499 status for client abort | Distinguishes intentional disconnect from server error; follows nginx convention |
| `clearGap()` as separate method from `clearEvents()` | Consumer may want to refetch data without clearing accumulated events |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- `pnpm --filter @aesir/dashboard run typecheck` -- zero errors
- `pnpm run lint` (biome check) -- zero errors
- All 5 files created with expected exports
- No `"use client"` on server-only files (sse-types.ts, event-stream-store.ts, route.ts)
- `"use client"` present on client files (use-event-stream.ts, connection-status.tsx)
- `useSyncExternalStore` used in hook (not useState+useEffect)
- `setInterval` used for batching timer
- Next.js build succeeds with new `/api/sse/events` route registered

## Next Phase Readiness

Plans 55-02 through 55-04 can now use:
- `useEventStream({ url: "/dashboard/api/sse/events", types: [...], conversationId: "..." })` in client wrappers
- `ConnectionStatusIndicator` next to page titles
- `LIFECYCLE_EVENT_TYPES` and `ALL_EVENT_TYPES` for type-safe type arrays
- `SseEvent` interface for typed event processing
- `EventStreamState.hasGap` flag to trigger data refetch on gap detection

No blockers identified.
