/**
 * Event Buffer
 *
 * Bounded circular buffer for SSE Last-Event-ID replay support.
 * Stores recent agent events so reconnecting SSE clients can replay
 * events missed during disconnection.
 *
 * Simple array-based implementation -- at 1000 items, array operations
 * (push, shift, filter) are sub-millisecond and sufficient for this use case.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * An event stored in the replay buffer.
 * Contains the serialized SSE payload and metadata for filtering.
 */
export interface BufferedEvent {
  /** String sequence ID used as SSE event id */
  id: string;
  /** Numeric sequence for ordering and Last-Event-ID comparison */
  sequence: number;
  /** Event type (e.g., "tool.called", "agent.started") */
  type: string;
  /** Conversation this event belongs to */
  conversationId: string;
  /** Full event payload (pre-serialized data for SSE) */
  data: unknown;
}

/**
 * Bounded event buffer for SSE replay.
 * Events older than maxSize are evicted on push (FIFO).
 */
export interface EventBuffer {
  /** Add an event to the buffer. Evicts oldest if at capacity. */
  push(event: BufferedEvent): void;
  /** Return all events with sequence > afterSequence, in order. */
  getAfter(afterSequence: number): BufferedEvent[];
  /** Return the sequence of the oldest buffered event, or null if empty. */
  getOldestSequence(): number | null;
  /** Return current number of buffered events. */
  size(): number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a bounded event buffer for SSE replay support.
 *
 * @param maxSize - Maximum number of events to retain (default: 1000)
 * @returns EventBuffer instance
 *
 * @example
 * ```ts
 * const buffer = createEventBuffer(1000);
 * buffer.push({ id: "1", sequence: 1, type: "tool.called", conversationId: "conv_abc", data: { ... } });
 * const missed = buffer.getAfter(0); // returns all events
 * ```
 */
export function createEventBuffer(maxSize = 1000): EventBuffer {
  const events: BufferedEvent[] = [];

  return {
    push(event: BufferedEvent): void {
      events.push(event);
      // Evict oldest when exceeding capacity
      while (events.length > maxSize) {
        events.shift();
      }
    },

    getAfter(afterSequence: number): BufferedEvent[] {
      return events.filter((e) => e.sequence > afterSequence);
    },

    getOldestSequence(): number | null {
      if (events.length === 0) return null;
      const oldest = events[0];
      return oldest ? oldest.sequence : null;
    },

    size(): number {
      return events.length;
    },
  };
}
