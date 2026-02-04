# Phase 55: Real-Time Updates - Research

**Researched:** 2026-02-04
**Domain:** Browser SSE consumption, React state management, Next.js server/client component boundary
**Confidence:** HIGH

## Summary

This phase wires the existing SSE backend (Phase 48's `GET /api/sse/events` on the agent service) into the dashboard's React pages. The SSE endpoint is fully built: it supports `?conversationId=&types=` filtering, `Last-Event-ID` replay from a bounded 1000-event buffer, gap detection, keepalive pings, and graceful shutdown. The dashboard is a Next.js 15.5.9 app with React 19, currently all server components with `force-dynamic` rendering. Pages use a service-layer abstraction that queries Postgres directly via Drizzle ORM. No client-side hooks or state management exists yet.

The core technical challenge is introducing client-side state management into a server-component-first architecture. The SSE stream originates from the agent-service (port 3004), the dashboard runs on port 3005, and nginx proxies both. The browser's `EventSource` can reach the agent-service SSE endpoint through nginx at `/agent/api/sse/events`. The implementation requires: (1) a connection management layer, (2) a batched state update mechanism, (3) client component wrappers around existing server-rendered presentational components, and (4) careful handling of the server/client component boundary.

**Primary recommendation:** Build a custom `useEventStream` hook using the native `EventSource` API (no library), a shared `EventStreamStore` class for connection management and 500ms batched updates, and `useSyncExternalStore` for React integration. Proxy SSE through a Next.js API route to avoid cross-origin issues and simplify the connection URL.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `EventSource` API | Browser built-in | SSE connection | Built-in reconnection, `Last-Event-ID` header, zero bundle size |
| `useSyncExternalStore` | React 19 built-in | Subscribe React to external store | Tear-safe, concurrent-mode compatible, official React API for external subscriptions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | - | - | The native EventSource + React built-ins are sufficient |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native EventSource | `reconnecting-eventsource` | Adds exponential backoff but the server already sends `retry: 3000` and native EventSource auto-reconnects. The 3s retry is fine for a monitoring dashboard. |
| Native EventSource | `event-source-plus` | Adds custom headers support; not needed since no auth headers are required for the SSE endpoint |
| `useSyncExternalStore` | `useState` + `useEffect` | Simpler but risks tearing in concurrent mode and requires manual snapshot caching |
| Custom hook | `@react-nano/use-event-source` or `react-sse-hooks` | Adds unnecessary dependency; our hook is ~80 lines and tailored to our batching requirement |

**Installation:**
```bash
# No new packages required -- all browser/React built-ins
```

## Architecture Patterns

### Recommended Project Structure

```
packages/dashboard/src/
├── hooks/
│   └── use-event-stream.ts       # Core SSE hook (EventSource + useSyncExternalStore)
├── lib/
│   └── event-stream-store.ts     # EventStreamStore class (connection, batching, state)
├── components/
│   ├── conversations/
│   │   └── live-conversations-table.tsx    # Client wrapper with SSE for list page
│   ├── conversation-detail/
│   │   ├── live-event-timeline.tsx         # Client wrapper with SSE for timeline
│   │   ├── live-message-panel.tsx          # Client wrapper with SSE for messages
│   │   └── live-metadata-sidebar.tsx       # Client wrapper with SSE for sidebar
│   └── overview/
│       ├── live-stat-cards.tsx             # Client wrapper with SSE for stats
│       └── live-active-conversations.tsx   # Client wrapper with SSE for active list
└── app/
    └── api/
        └── sse/
            └── events/
                └── route.ts              # Next.js API route SSE proxy
```

### Pattern 1: EventStreamStore (External Store for SSE)

**What:** A plain TypeScript class that manages EventSource connection, buffering, and batched state snapshots. Not a React component -- it's an external store that React subscribes to via `useSyncExternalStore`.

**When to use:** Always. This is the core pattern for the entire phase.

**Why this pattern:** The 500ms batching requirement means we cannot update React state on every SSE event. We need an intermediate buffer that collects events and flushes on a timer. `useSyncExternalStore` is the React-blessed way to subscribe to such external mutable state without tearing.

**Example:**
```typescript
// lib/event-stream-store.ts

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface EventStreamState {
  events: SseEvent[];
  status: ConnectionStatus;
  lastEventId: string | null;
}

type Listener = () => void;

class EventStreamStore {
  private eventSource: EventSource | null = null;
  private buffer: SseEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private state: EventStreamState;
  private listeners = new Set<Listener>();

  constructor(private url: string, private batchIntervalMs = 500) {
    this.state = { events: [], status: "disconnected", lastEventId: null };
  }

  // useSyncExternalStore requires these two methods
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EventStreamState => {
    return this.state; // Must return SAME reference unless state changed
  };

  connect(): void {
    if (this.eventSource) return;
    this.updateState({ ...this.state, status: "connecting" });

    const es = new EventSource(this.url);
    this.eventSource = es;

    es.onopen = () => {
      this.updateState({ ...this.state, status: "connected" });
    };

    es.onerror = () => {
      // EventSource auto-reconnects; we just track status
      if (es.readyState === EventSource.CLOSED) {
        this.updateState({ ...this.state, status: "disconnected" });
      } else {
        this.updateState({ ...this.state, status: "error" });
      }
    };

    // Listen for all SSE event types (the server sends named events)
    es.onmessage = (e) => {
      this.buffer.push(JSON.parse(e.data));
    };

    // Named event listener pattern for typed SSE events
    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        this.buffer.push({ ...data, _sseType: eventType });
        // Track Last-Event-ID for reconnection
        if (e.lastEventId) {
          this.state = { ...this.state, lastEventId: e.lastEventId };
        }
      });
    }

    // Start batch flush timer
    this.flushTimer = setInterval(() => this.flush(), this.batchIntervalMs);
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer.length = 0;
    const newEvents = [...this.state.events, ...batch];
    this.updateState({ ...this.state, events: newEvents });
  }

  private updateState(next: EventStreamState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.updateState({ ...this.state, status: "disconnected" });
  }
}
```

### Pattern 2: useEventStream Hook (React Bridge)

**What:** A thin React hook that creates/manages an `EventStreamStore` and exposes its state via `useSyncExternalStore`.

**When to use:** In every client component that needs SSE data.

**Example:**
```typescript
// hooks/use-event-stream.ts
import { useEffect, useMemo, useSyncExternalStore } from "react";

interface UseEventStreamOptions {
  /** SSE endpoint URL */
  url: string;
  /** Event types to subscribe to (server-side filtering via ?types=) */
  types?: string[];
  /** Specific conversation ID to filter for */
  conversationId?: string;
  /** Whether the connection is enabled (default: true) */
  enabled?: boolean;
  /** Batch interval in ms (default: 500) */
  batchIntervalMs?: number;
}

export function useEventStream(options: UseEventStreamOptions) {
  const { url, types, conversationId, enabled = true, batchIntervalMs = 500 } = options;

  // Build SSE URL with query params
  const sseUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (types?.length) params.set("types", types.join(","));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }, [url, types, conversationId]);

  // Create store instance (stable across renders for same URL)
  const store = useMemo(
    () => new EventStreamStore(sseUrl, batchIntervalMs),
    [sseUrl, batchIntervalMs]
  );

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    if (!enabled) return;
    store.connect();
    return () => store.disconnect();
  }, [store, enabled]);

  // Subscribe React to the external store
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    // SSR snapshot: return empty/disconnected state
    () => ({ events: [], status: "disconnected" as const, lastEventId: null })
  );

  return state;
}
```

### Pattern 3: Client Component Wrapper (Server/Client Boundary)

**What:** Each page that needs real-time updates gets a "live" client component wrapper that combines server-rendered initial data with SSE updates.

**When to use:** For conversations list, conversation detail, and system overview pages.

**Why:** The existing pages are async server components that cannot use hooks. Rather than rewriting them as client components, we create thin client wrappers that receive server-rendered data as props (initial state) and layer SSE updates on top.

**Example:**
```typescript
// components/conversations/live-conversations-table.tsx
"use client";

import { useState, useEffect } from "react";
import { useEventStream } from "@/hooks/use-event-stream";
import { ConversationsTable } from "./data-table";
import type { ConversationListItem } from "@/services/conversations";

interface LiveConversationsTableProps {
  initialData: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  agentDefinitions: string[];
}

export function LiveConversationsTable({
  initialData,
  total,
  page,
  pageSize,
  agentDefinitions,
}: LiveConversationsTableProps) {
  const [data, setData] = useState(initialData);

  const { events, status } = useEventStream({
    url: "/dashboard/api/sse/events",
    types: ["agent.started", "agent.completed", "agent.paused", "agent.resumed"],
  });

  // Apply SSE updates to the existing data
  useEffect(() => {
    if (events.length === 0) return;
    setData(prev => applyConversationUpdates(prev, events));
  }, [events]);

  return (
    <>
      {/* Connection status indicator */}
      <ConversationsTable
        data={data}
        total={total}
        page={page}
        pageSize={pageSize}
        agentDefinitions={agentDefinitions}
      />
    </>
  );
}
```

### Pattern 4: Next.js API Route SSE Proxy

**What:** A Next.js API route that proxies SSE requests from the browser to the agent-service, avoiding cross-origin issues.

**When to use:** Always. The browser makes EventSource requests to `/dashboard/api/sse/events`, which the Next.js route handler proxies to `http://agent-service:3004/api/sse/events`.

**Why:** The dashboard has `basePath: "/dashboard"`. The agent-service SSE endpoint is on a different port/host. Rather than dealing with CORS or requiring the browser to know the agent-service URL, we proxy through Next.js. This also keeps the architecture consistent with the existing `lib/agent-service.ts` pattern where the dashboard abstracts the agent-service URL.

**Example:**
```typescript
// app/api/sse/events/route.ts
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentServiceUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:3004";

  // Forward query params and Last-Event-ID header
  const targetUrl = `${agentServiceUrl}/api/sse/events?${searchParams.toString()}`;
  const headers: Record<string, string> = {};

  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  const response = await fetch(targetUrl, {
    headers,
    signal: request.signal,
  });

  // Stream the SSE response directly through
  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

**Important consideration for the proxy approach:** Next.js API routes with streaming have limitations -- the route handler process must stay alive for the duration of the SSE connection. In standalone mode this works fine. The alternative is to have the browser connect directly through nginx to `/agent/api/sse/events`, which avoids the proxy overhead entirely. Both approaches work; the proxy is simpler for the client code.

**Recommendation:** Use the Next.js API route proxy. It keeps the client code simple (`/dashboard/api/sse/events`), avoids CORS, and the dashboard server is already a long-running process. If proxy reliability becomes an issue, switching to direct nginx access is a 1-line URL change in the hook.

### Anti-Patterns to Avoid

- **Per-event React state updates:** Setting state on every SSE event causes excessive re-renders. The 500ms batching requirement exists precisely to prevent this. Always buffer events and flush on a timer.
- **EventSource inside useEffect without cleanup:** Always call `eventSource.close()` in the useEffect cleanup. Orphaned connections hit the browser's 6-connection-per-domain limit (HTTP/1.1) and leak server resources.
- **Recreating EventSource on every render:** The EventSource URL must be memoized. If the URL string changes on every render, the hook will disconnect/reconnect continuously.
- **Storing EventSource in state:** Never put the EventSource instance in React state. Use a ref or an external class. EventSource is mutable and not serializable.
- **Converting server components to client components:** Don't replace existing server component pages with client components. Use client component wrappers that receive server-rendered initial data as props.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE connection management | Custom reconnection logic | Native `EventSource` auto-reconnection | Browser handles reconnection with `retry:` directive. Server already sends `retry: 3000\n\n`. Adding exponential backoff adds complexity for minimal benefit in a monitoring dashboard. |
| React external store subscription | Manual `useState` + `useEffect` subscriber pattern | `useSyncExternalStore` | Handles concurrent mode tearing, snapshot consistency, and subscription lifecycle correctly. The alternative requires reimplementing these guarantees. |
| SSE event parsing | Custom text/event-stream parser | Native `EventSource` message parsing | The browser parses `id:`, `event:`, `data:`, `retry:` fields. Building a custom parser would only be needed for non-EventSource approaches (e.g., `fetch` + ReadableStream). |

**Key insight:** The browser's `EventSource` API already handles most of the complexity (parsing, reconnection, Last-Event-ID). The only thing we add is the 500ms batching buffer and React integration.

## Common Pitfalls

### Pitfall 1: Browser Connection Limit (HTTP/1.1)

**What goes wrong:** Without HTTP/2, browsers limit SSE connections to 6 per domain. If the dashboard opens multiple SSE connections (one per page), the browser queues them and the page appears stuck.

**Why it happens:** HTTP/1.1 spec limits concurrent connections per origin. Each EventSource counts as one persistent connection.

**How to avoid:** Use a single shared connection at the layout level that subscribes to all event types. Client components filter events by conversation ID or event type client-side. Alternatively, ensure the nginx proxy supports HTTP/2 (not currently configured). Since this is a monitoring dashboard (likely 1 browser tab), the risk is low, but the single-connection pattern is more robust.

**Recommendation:** Use per-page connections but keep it to 1 connection per page (not per component). The dashboard will have at most 1 page open at a time per tab, well under the 6-connection limit. Use the `enabled` flag to disconnect when navigating away.

**Warning signs:** Pages hang with no SSE data arriving. Check `chrome://net-internals/#events` for queued connections.

### Pitfall 2: Memory Leak from Unbounded Event Accumulation

**What goes wrong:** The SSE stream delivers events continuously. If the client-side buffer grows without bound, the page consumes increasing memory.

**Why it happens:** The conversation detail page accumulates events in its local state. A long-running conversation could produce thousands of events.

**How to avoid:** Cap the client-side event buffer. The CONTEXT.md specifies a 1000-event cap with a "load earlier" mechanism. When the buffer exceeds 1000, drop the oldest events and show a "load earlier" button that fetches from the database.

**Warning signs:** Browser memory usage climbs steadily while viewing a running conversation.

### Pitfall 3: Stale Closures in Event Handlers

**What goes wrong:** Event handlers reference stale state values because they were captured in a previous render's closure.

**Why it happens:** When using `useEffect` with EventSource event handlers, the handler closes over the state at the time the effect ran. If state updates, the handler still sees the old value.

**How to avoid:** Use the external store pattern (EventStreamStore class). The store manages its own state outside of React's render cycle. The `useSyncExternalStore` hook ensures React reads the latest snapshot on every render. Avoid putting SSE processing logic inside `useEffect` callbacks that reference other state variables.

### Pitfall 4: SSE Proxy Connection Drop

**What goes wrong:** The Next.js API route SSE proxy drops the connection due to idle timeout, and the EventSource reconnects but misses events.

**Why it happens:** The nginx `proxy_read_timeout` is set to 60s. If no SSE event arrives within 60s, nginx closes the connection. The agent-service sends keepalive pings every 20s, but this timeout applies to the nginx-to-agent-service leg, not the browser-to-nginx leg.

**How to avoid:** The agent-service already sends keepalive pings every 20 seconds (`:ping\n\n`). These prevent nginx from timing out the upstream connection. The Next.js proxy must stream these through transparently. If using the direct nginx path (`/agent/api/sse/events`), the keepalive pings keep the connection alive. Verify the proxy streams keepalive comments through without buffering them.

**Warning signs:** SSE connection drops every ~60 seconds and reconnects.

### Pitfall 5: Server/Client Component Boundary Confusion

**What goes wrong:** Attempting to use hooks in server components, or importing server-only code (Drizzle, `pg`) into client components.

**Why it happens:** The existing pages are async server components. Adding SSE requires client-side JavaScript. Mixing these requires careful component boundary management.

**How to avoid:** Follow the wrapper pattern: server component pages fetch initial data and pass it as props to client component wrappers. The client wrapper imports the `useEventStream` hook and the existing presentational components. Never import from `@/lib/db` or `@/services/*` in client components.

**Warning signs:** Build errors about `pg` or `drizzle-orm` in client bundles. Runtime errors about hooks in server components.

### Pitfall 6: useSyncExternalStore getSnapshot Must Return Cached Reference

**What goes wrong:** Infinite re-render loop because `getSnapshot` returns a new object on every call.

**Why it happens:** React calls `getSnapshot` on every render to check if the store changed. If it returns a new object reference each time (even with identical content), React thinks the store changed and re-renders.

**How to avoid:** The `EventStreamStore` class must cache its state object and only create a new reference when the state actually changes (i.e., when `updateState()` is called). The `getSnapshot` method just returns `this.state`.

**Warning signs:** Component re-renders infinitely, browser becomes unresponsive.

## Code Examples

### SSE Event Payload Shape (from agent-service)

The SSE endpoint sends named events where the `event:` field matches the agent event type:

```
id: 42
event: tool.called
data: {"id":"aevt_xxx","conversationId":"conv_abc","agentDefinitionId":"dev-agent","type":"tool.called","payload":{"tool_name":"read_file"},"sequence":42,"timestamp":"2026-02-04T10:00:00.000Z","tokenCountInput":null,"tokenCountOutput":null,"durationMs":null}
```

Source: `packages/agents/src/service/api/sse-events.ts` - `buildEventPayload()` function, line 94-118.

### Agent Event Types (for `?types=` filtering)

```typescript
// Source: packages/dashboard/src/lib/schema.ts line 60-71
const agentEventTypeValues = [
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
```

**Per-page type subscriptions:**
- **Conversations list:** `agent.started,agent.completed,agent.paused,agent.resumed` (lifecycle events only)
- **Conversation detail:** All types (full event stream for the specific conversation)
- **System overview:** `agent.started,agent.completed,agent.paused,agent.resumed` (lifecycle events for stat counts and active list)

### Existing Server Component Data Flow (to understand what the client wrapper receives)

```typescript
// Conversations list page (packages/dashboard/src/app/conversations/page.tsx)
// Server component fetches data and passes to client component
const [{ items, total }, agentDefinitions] = await Promise.all([
  listConversations({ /* filters */ }),
  getDistinctAgentDefinitions(),
]);
// items: ConversationListItem[], total: number, agentDefinitions: string[]

// Conversation detail page (packages/dashboard/src/app/conversations/[id]/page.tsx)
// Server component fetches 4 data sets in parallel
const [conversation, events, messages, childConversations] = await Promise.all([
  getConversationById(id),       // ConversationDetail
  getConversationEvents(id),     // ConversationEvent[]
  getConversationMessages(id),   // unknown[] (Anthropic message format)
  getChildConversations(id),     // ChildConversation[]
]);

// Overview page (packages/dashboard/src/app/page.tsx)
// Server component fetches 5 data sets in parallel
const [statusCounts, activeConversations, workerStatus, recentErrors, tokenUsage] = await Promise.all([
  getConversationStatusCounts(),  // StatusCounts
  getActiveConversations(),       // ActiveConversation[]
  fetchWorkerStatus(),            // WorkerStatus | null
  getRecentErrors(),              // RecentError[]
  getTokenUsageByAgent(),         // TokenUsageByAgent[]
]);
```

### SSE URL Construction

The browser's EventSource will connect to:
```
/dashboard/api/sse/events?types=agent.started,agent.completed&conversationId=conv_abc
```

The Next.js API route proxy forwards to:
```
http://agent-service:3004/api/sse/events?types=agent.started,agent.completed&conversationId=conv_abc
```

With `Last-Event-ID` header forwarded for replay.

### Applying SSE Events to Conversations List

```typescript
function applyConversationUpdates(
  current: ConversationListItem[],
  events: SseEvent[]
): ConversationListItem[] {
  const updates = new Map<string, Partial<ConversationListItem>>();

  for (const event of events) {
    const conversationId = event.conversationId;

    switch (event.type) {
      case "agent.started": {
        // New conversation -- add to list if not already present
        if (!current.find(c => c.id === conversationId)) {
          updates.set(conversationId, {
            id: conversationId,
            agentDefinitionId: event.agentDefinitionId,
            status: "running",
            createdAt: new Date(event.timestamp),
            updatedAt: new Date(event.timestamp),
            // Token counts start at 0
            tokenInput: 0,
            tokenOutput: 0,
            triggerEventType: event.type,
            lastActivity: new Date(event.timestamp),
            errorMessage: null,
          });
        }
        break;
      }
      case "agent.completed":
      case "agent.paused":
      case "agent.resumed": {
        const statusMap: Record<string, string> = {
          "agent.completed": "completed",
          "agent.paused": "waiting",
          "agent.resumed": "running",
        };
        updates.set(conversationId, {
          ...(updates.get(conversationId) ?? {}),
          status: statusMap[event.type] ?? "running",
          updatedAt: new Date(event.timestamp),
          lastActivity: new Date(event.timestamp),
        });
        break;
      }
    }
  }

  // Apply updates to existing items
  let result = current.map(item => {
    const update = updates.get(item.id);
    if (update) {
      updates.delete(item.id);
      return { ...item, ...update };
    }
    return item;
  });

  // Add new conversations (agent.started for conversations not in the list)
  for (const [, newItem] of updates) {
    result = [newItem as ConversationListItem, ...result];
  }

  return result;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebSocket for all real-time | SSE for server-to-client, WebSocket only for bidirectional | Always been this way for SSE use cases | SSE is simpler, has built-in reconnection, uses standard HTTP |
| `useState` + `useEffect` for external subscriptions | `useSyncExternalStore` | React 18 (2022) | Concurrent mode safe, prevents tearing |
| Polling for dashboard updates | SSE streaming | This phase | Eliminates polling latency, reduces server load |
| Library dependencies for SSE (eventsource polyfill) | Native `EventSource` API | All modern browsers support it | Zero bundle size for SSE connection |

**Deprecated/outdated:**
- `eventsource` npm polyfill: Only needed for very old Node.js environments. All modern browsers support `EventSource` natively.
- React `useSubscription`: Replaced by `useSyncExternalStore` in React 18+.

## Discretion Recommendations

Based on the CONTEXT.md, these decisions are left to Claude's discretion. Here are specific recommendations with reasoning:

### Row Update Animation Style
**Recommendation: Subtle highlight fade.** When a row updates (status change), apply a brief CSS transition (`bg-accent/30` fading to transparent over 1.5s via `transition-colors duration-1500`). This signals to the user that something changed without being distracting. Use CSS classes and transitions -- no animation library needed. Tailwind's `transition-colors` with a custom duration class is sufficient.

### List Re-sorting on Status Change
**Recommendation: Do not re-sort.** The conversations list is sorted by `created_at DESC` (newest first). Re-sorting on status change would cause rows to jump around, which is disorienting. Instead, update the row in-place and let the highlight fade draw attention to it. The user can manually re-sort or apply filters.

### Timeline Auto-scroll Behavior
**Recommendation: Smart scroll -- auto-scroll only if the user is already at the bottom.** Track whether the scroll position is near the bottom (within 100px). If yes, auto-scroll when new events arrive. If the user has scrolled up to inspect earlier events, do not auto-scroll (this would be jarring). Show a small "New events" pill at the bottom that scrolls to the latest when clicked.

### Overview Stat Card Animation
**Recommendation: Instant update with highlight.** Stat counts update immediately (no animated counter). The card gets a brief border/background pulse (same as row highlight pattern) to draw attention. Animated counters (counting up from old to new value) add visual noise for a monitoring dashboard where quick scanning matters more than animation.

### Disconnect/Reconnect UX
**Recommendation: Small status dot in the page header.** A small colored dot (green = connected, yellow = reconnecting, red = disconnected) next to the page title. No banner or toast -- this is a developer monitoring tool where connection status should be visible but not intrusive. When disconnected for >10 seconds, add a subtle "(live updates paused)" text next to the dot.

### Reconnect Sync Strategy
**Recommendation: Rely on `Last-Event-ID` replay (built-in).** The native EventSource automatically sends `Last-Event-ID` on reconnect. The server's EventBuffer replays missed events. If a `gap` event is received (events expired from buffer), trigger a full page data refetch using `router.refresh()` (Next.js server component re-fetch). This hybrid approach handles short disconnects with replay and long disconnects with refetch.

### Connection Scope
**Recommendation: Per-page connections with cleanup on navigation.** Each page creates its own SSE connection with appropriate `?types=` and `?conversationId=` filters. When navigating away, the hook's cleanup function closes the connection. This is simpler than a shared layout-level connection and takes advantage of server-side type filtering to minimize bandwidth. The dashboard typically has 1 tab open, so the connection limit is not a concern.

### Live Update Indicator
**Recommendation: Yes, a small "Live" badge.** A small green-pulsing "Live" badge near the page title when connected. Helps distinguish between static (completed conversation) and live (running conversation) views. On the conversations list, show it always. On conversation detail, show it only when the conversation status is `running` or `waiting`.

### New Conversation Appearance in List
**Recommendation: Auto-appear at the top with highlight.** New conversations from `agent.started` events prepend to the list with the highlight fade animation. Since the list is sorted newest-first, this is the natural position. A "N new" banner adds an extra click and is better suited for social feeds, not monitoring dashboards where immediate visibility matters.

### Metadata Sidebar Live Updates
**Recommendation: Yes, update status and timestamps live.** The metadata sidebar shows conversation status, timestamps, and child conversation status. These should update live when SSE events arrive. Token totals can be derived from `llm.response` events by accumulating `tokenCountInput` and `tokenCountOutput` from the SSE stream.

### Token Total / Duration Refresh
**Recommendation: Accumulate from SSE events.** The conversation detail SSE stream receives all event types including `llm.response`. Each `llm.response` event includes `tokenCountInput` and `tokenCountOutput`. Accumulate these client-side and add to the server-rendered initial totals. Duration is computed client-side from the conversation's `createdAt` to `now` (already done in the overview's active conversations component). No separate API call needed.

## Open Questions

1. **Next.js streaming response in standalone mode reliability**
   - What we know: Next.js Route Handlers can return streaming `Response` objects. The standalone output runs as a regular Node.js server.
   - What's unclear: Whether long-lived SSE proxy connections through Next.js Route Handlers are production-stable (memory leaks, connection limits).
   - Recommendation: Start with the proxy approach. If issues arise, switch to direct nginx access at `/agent/api/sse/events` (requires updating the nginx config to add SSE-specific timeouts for that path). The hook URL is a single configuration point.

2. **Gap event handling granularity**
   - What we know: The server sends a `gap` event when `Last-Event-ID` references events that have been evicted from the buffer.
   - What's unclear: Whether `router.refresh()` is sufficient to re-sync the page, or whether we need a more targeted refetch.
   - Recommendation: Use `router.refresh()` for the conversations list and overview (full page re-render from server). For conversation detail, fetch only new events from the REST API (using `afterSequence` parameter) instead of refreshing the whole page.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/agents/src/service/api/sse-events.ts` -- full SSE endpoint implementation, query params, replay, keepalive
- Codebase inspection: `packages/agents/src/service/api/event-buffer.ts` -- bounded buffer with 1000-event default
- Codebase inspection: `packages/dashboard/src/` -- all existing pages, services, components, lib files
- Codebase inspection: `docker-config/nginx.conf` -- proxy configuration, buffering, timeouts
- Codebase inspection: `docker-compose.yml` -- AGENT_SERVICE_URL, network topology
- [MDN EventSource/SSE documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- EventSource API, connection limits, reconnection
- [React useSyncExternalStore reference](https://react.dev/reference/react/useSyncExternalStore) -- API, snapshot caching requirements, subscription pattern

### Secondary (MEDIUM confidence)
- [OneUptime SSE in React guide (Jan 2026)](https://oneuptime.com/blog/post/2026-01-15-server-sent-events-sse-react/view) -- useSSEWithReconnect pattern, production considerations
- [HTML Living Standard: Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) -- authoritative spec for EventSource behavior

### Tertiary (LOW confidence)
- [reconnecting-eventsource npm](https://www.npmjs.com/package/reconnecting-eventsource) -- enhanced reconnection (not recommended for this project but documented for context)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Native browser API + React built-in. No library decisions needed.
- Architecture: HIGH -- Patterns derived from direct codebase inspection and React official docs. The server/client boundary pattern is well-established in Next.js 15.
- Pitfalls: HIGH -- Most pitfalls identified from codebase inspection (nginx timeouts, connection limits, component boundary). The EventSource connection limit is documented in MDN.
- Discretion recommendations: MEDIUM -- Based on UI/UX best practices and codebase patterns. Some choices (like auto-scroll behavior) are subjective and may need adjustment after testing.

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days -- stable domain, no fast-moving library dependencies)
