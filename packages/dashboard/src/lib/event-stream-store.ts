/**
 * EventStreamStore
 *
 * Plain TypeScript class that manages an EventSource connection with
 * 500ms batched updates. Designed as an external store for React's
 * useSyncExternalStore -- not a React component.
 *
 * Key behaviors:
 * - Connects to an SSE endpoint via native EventSource
 * - Buffers incoming events and flushes every batchIntervalMs (default 500ms)
 * - Exposes subscribe/getSnapshot for useSyncExternalStore compatibility
 * - Caches state reference (only creates new reference on actual change)
 * - Listens for named SSE event types (server sends `event: tool.called`, etc.)
 * - Listens for special `gap` event (sets hasGap flag for consumer refetch)
 * - Tracks lastEventId from SSE event IDs for reconnection replay
 * - Caps events array at maxEvents (default 1000), dropping oldest on overflow
 *
 * Safe to import from both client and server -- no browser globals at module level.
 */

import {
  ALL_EVENT_TYPES,
  type EventStreamState,
  type SseEvent,
} from "./sse-types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type Listener = () => void;

// ─── EventStreamStore ───────────────────────────────────────────────────────

export class EventStreamStore {
  private eventSource: EventSource | null = null;
  private buffer: SseEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private state: EventStreamState;
  private listeners = new Set<Listener>();

  constructor(
    private readonly url: string,
    private readonly batchIntervalMs = 500,
    private readonly maxEvents = 1000,
  ) {
    this.state = {
      events: [],
      status: "disconnected",
      lastEventId: null,
      hasGap: false,
    };
  }

  // ─── useSyncExternalStore API ───────────────────────────────────────

  /**
   * Subscribe a listener to state changes.
   * Returns an unsubscribe function.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Return the current state snapshot.
   * Returns the SAME reference unless state has actually changed.
   */
  getSnapshot = (): EventStreamState => {
    return this.state;
  };

  // ─── Connection Lifecycle ───────────────────────────────────────────

  /**
   * Open an EventSource connection and start the batch flush timer.
   * No-op if already connected.
   */
  connect(): void {
    if (this.eventSource) return;

    this.updateState({ ...this.state, status: "connecting" });

    const url = this.state.lastEventId
      ? this.appendLastEventId(this.url, this.state.lastEventId)
      : this.url;

    const es = new EventSource(url);
    this.eventSource = es;

    es.onopen = () => {
      this.updateState({ ...this.state, status: "connected" });
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        this.updateState({ ...this.state, status: "disconnected" });
      } else {
        // EventSource auto-reconnects; we track the error state
        this.updateState({ ...this.state, status: "error" });
      }
    };

    // Listen for all named SSE event types
    for (const eventType of ALL_EVENT_TYPES) {
      es.addEventListener(eventType, (e: Event) => {
        const messageEvent = e as MessageEvent;
        try {
          const data = JSON.parse(messageEvent.data) as SseEvent;
          this.buffer.push(data);

          // Track lastEventId for reconnection
          if (messageEvent.lastEventId) {
            this.state = {
              ...this.state,
              lastEventId: messageEvent.lastEventId,
            };
          }
        } catch {
          // Ignore malformed SSE events
        }
      });
    }

    // Listen for the special "gap" event (events expired from server buffer)
    es.addEventListener("gap", () => {
      this.updateState({ ...this.state, hasGap: true });
    });

    // Start batch flush timer
    this.flushTimer = setInterval(() => this.flush(), this.batchIntervalMs);
  }

  /**
   * Close the EventSource connection and clean up resources.
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining buffered events before disconnecting
    this.flush();

    this.updateState({ ...this.state, status: "disconnected" });
  }

  // ─── Public Methods ─────────────────────────────────────────────────

  /**
   * Clear all accumulated events. Used by consumers on navigation
   * or when switching conversation context.
   */
  clearEvents(): void {
    this.updateState({
      ...this.state,
      events: [],
      hasGap: false,
    });
  }

  /**
   * Reset the hasGap flag after consumer has handled the gap
   * (e.g., triggered a full data refetch).
   */
  clearGap(): void {
    this.updateState({ ...this.state, hasGap: false });
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * Flush buffered events into the state snapshot.
   * Only creates a new state reference if the buffer is non-empty.
   */
  private flush(): void {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    let newEvents = [...this.state.events, ...batch];

    // Cap at maxEvents, dropping oldest
    if (newEvents.length > this.maxEvents) {
      newEvents = newEvents.slice(newEvents.length - this.maxEvents);
    }

    this.updateState({ ...this.state, events: newEvents });
  }

  /**
   * Update the cached state and notify all listeners.
   */
  private updateState(next: EventStreamState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Append lastEventId as a query parameter for initial connection.
   * EventSource natively sends Last-Event-ID on reconnection, but
   * for the initial connection we forward it as a query param so the
   * proxy API route can pass it as a header to the upstream.
   */
  private appendLastEventId(baseUrl: string, lastEventId: string): string {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}lastEventId=${encodeURIComponent(lastEventId)}`;
  }
}
