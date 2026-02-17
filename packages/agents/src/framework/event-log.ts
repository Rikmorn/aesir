/**
 * EventLog Implementation
 *
 * Factory producing an append-only event recording system with buffered writes,
 * gapless per-conversation sequences, subscriber notification, and query capabilities.
 *
 * - append() is synchronous (void) to avoid blocking the agent loop
 * - Events are buffered and flushed at configurable intervals or when buffer is full
 * - flush() forces immediate persistence (call at lifecycle boundaries)
 * - subscribe() enables reactive patterns (e.g., SessionProjection)
 * - Gapless per-conversation sequences assigned automatically
 *
 * Follows the createTraceRecorder() pattern from trace-recorder.ts but adds:
 * timer-based flush, subscriber notification, gapless sequence tracking, and query.
 */

import { createId } from "@aesir/types";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  type AgentEvent,
  agentEventContent,
  agentEvents,
  type NewAgentEvent,
  type NewAgentEventContent,
} from "../shared/db/schema.js";
import type {
  AppendEventInput,
  EventLog,
  EventLogOptions,
  EventQueryOptions,
  EventSubscriptionFilter,
  EventSubscriptionHandler,
  Unsubscribe,
} from "./types.js";

// ---------------------------------------------------------------------------
// Truncation Helper (copied from trace-recorder.ts to avoid cross-module dep)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 10240; // 10KB

/**
 * Truncate a payload to fit within maxBytes when serialized.
 *
 * - Strings: slice and append " [truncated]"
 * - Objects: JSON.stringify, check length, return preview object if too large
 * - Primitives (null, undefined, number, boolean): return as-is
 */
function truncateJsonPayload(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_BYTES,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > maxBytes) {
      return `${value.slice(0, maxBytes)} [truncated]`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // Objects and arrays
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) {
      return {
        truncated: true,
        preview: serialized.slice(0, maxBytes),
      };
    }
    return value;
  } catch {
    return { truncated: true, preview: "[unserializable]" };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EventLog instance with buffered writes, gapless sequences,
 * subscriber notification, and query capabilities.
 *
 * @example
 * ```ts
 * const eventLog = createEventLog({ db, logger });
 *
 * await eventLog.initSequence("conv_abc123");
 *
 * eventLog.append({
 *   conversationId: "conv_abc123",
 *   agentDefinitionId: "dev-agent",
 *   agentDefinitionVersion: "1.0.0",
 *   agentInstanceId: "ainst_xyz",
 *   type: "tool.called",
 *   payload: { toolName: "read_file" },
 * });
 *
 * await eventLog.flush();
 * ```
 */
export function createEventLog(options: EventLogOptions): EventLog {
  const {
    db,
    logger,
    flushIntervalMs = 1000,
    maxBufferSize = 100,
    maxPayloadBytes = 10240,
  } = options;

  // Validate required options
  if (!db) throw new Error("db is required for EventLog");
  if (!logger) throw new Error("logger is required for EventLog");

  // Internal state
  const buffer: NewAgentEvent[] = [];
  const contentBuffer: NewAgentEventContent[] = [];
  const sequenceCounters = new Map<string, number>();
  const subscribers = new Map<
    string,
    { filter: EventSubscriptionFilter; handler: EventSubscriptionHandler }
  >();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  // ─── Internal Helpers ───────────────────────────────────────────────

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await doFlush();
    }, flushIntervalMs);
    // Don't prevent Node.js from exiting
    if (flushTimer && typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref();
    }
  }

  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return;

    // Clear timer if set
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    // Copy and clear buffers
    const count = buffer.length;
    const toInsert = [...buffer];
    const contentToInsert = [...contentBuffer];
    buffer.length = 0;
    contentBuffer.length = 0;

    try {
      // Insert events and content atomically -- content FK references events
      await db.insert(agentEvents).values(toInsert);
      if (contentToInsert.length > 0) {
        await db.insert(agentEventContent).values(contentToInsert);
      }
      logger.debug(
        { count, contentCount: contentToInsert.length },
        "Flushed events",
      );
    } catch (error) {
      // Best-effort: log but do NOT re-throw
      logger.error({ err: error, count }, "Failed to flush events to database");
    }
  }

  function notifySubscribers(record: AgentEvent): void {
    for (const [, entry] of subscribers) {
      const { filter, handler } = entry;

      // Check type filter
      if (
        filter.types &&
        filter.types.length > 0 &&
        !filter.types.includes(record.type)
      ) {
        continue;
      }

      // Fire-and-forget: never block append()
      void handler(record).catch((err) =>
        logger.error(
          { err, subscriptionType: record.type },
          "Event subscriber handler error",
        ),
      );
    }
  }

  // ─── EventLog Interface ─────────────────────────────────────────────

  return {
    append(event: AppendEventInput): void {
      if (closed) {
        throw new Error("EventLog is closed");
      }

      // Get sequence counter for this conversation
      const currentSeq = sequenceCounters.get(event.conversationId);
      if (currentSeq === undefined) {
        throw new Error(
          `Sequence not initialized for conversation ${event.conversationId}. Call initSequence() first.`,
        );
      }

      // Increment and assign
      const nextSeq = currentSeq + 1;
      sequenceCounters.set(event.conversationId, nextSeq);

      // Build the record
      const eventId = event.id ?? createId.agentEvent();
      const record: NewAgentEvent = {
        id: eventId,
        conversation_id: event.conversationId,
        agent_definition_id: event.agentDefinitionId,
        agent_definition_version: event.agentDefinitionVersion,
        agent_instance_id: event.agentInstanceId,
        parent_instance_id: event.parentInstanceId ?? null,
        sequence: nextSeq,
        type: event.type,
        payload: truncateJsonPayload(
          event.payload ?? {},
          maxPayloadBytes,
        ) as Record<string, unknown>,
        timestamp: new Date(),
        token_count_input: event.tokenCountInput ?? null,
        token_count_output: event.tokenCountOutput ?? null,
        duration_ms: event.durationMs ?? null,
      };

      buffer.push(record);

      // Buffer content if provided (will be flushed atomically with the event)
      if (event.content && event.content.length > 0) {
        contentBuffer.push({
          event_id: eventId,
          content: event.content,
        });
      }

      // Notify subscribers immediately (in-memory, before persistence)
      notifySubscribers(record as AgentEvent);

      // Check buffer size
      if (buffer.length >= maxBufferSize) {
        // Eager flush -- fire-and-forget
        void doFlush();
      } else {
        scheduleFlush();
      }
    },

    async initSequence(conversationId: string): Promise<void> {
      const result = await db
        .select({
          maxSeq: sql<number>`COALESCE(MAX(${agentEvents.sequence}), 0)`,
        })
        .from(agentEvents)
        .where(eq(agentEvents.conversation_id, conversationId));

      sequenceCounters.set(conversationId, result[0]?.maxSeq ?? 0);
    },

    async query(
      conversationId: string,
      queryOptions?: EventQueryOptions,
    ): Promise<AgentEvent[]> {
      // Flush first to ensure consistency
      await doFlush();

      // Build conditions
      const conditions = [eq(agentEvents.conversation_id, conversationId)];

      if (queryOptions?.types && queryOptions.types.length > 0) {
        conditions.push(inArray(agentEvents.type, queryOptions.types));
      }

      if (queryOptions?.afterSequence !== undefined) {
        conditions.push(gt(agentEvents.sequence, queryOptions.afterSequence));
      }

      // Build and execute query
      const baseQuery = db
        .select()
        .from(agentEvents)
        .where(and(...conditions))
        .orderBy(asc(agentEvents.sequence));

      if (queryOptions?.limit !== undefined) {
        return await baseQuery.limit(queryOptions.limit);
      }

      return await baseQuery;
    },

    subscribe(
      filter: EventSubscriptionFilter,
      handler: EventSubscriptionHandler,
    ): Unsubscribe {
      const subscriptionId = createId.event();
      subscribers.set(subscriptionId, { filter, handler });
      return () => {
        subscribers.delete(subscriptionId);
      };
    },

    getSequence(conversationId: string): number {
      return sequenceCounters.get(conversationId) ?? 0;
    },

    async flush(): Promise<void> {
      await doFlush();
    },

    async close(): Promise<void> {
      closed = true;

      // Clear timer
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      // Flush remaining events
      await doFlush();

      // Clear state
      subscribers.clear();
      sequenceCounters.clear();

      logger.info("EventLog closed");
    },
  };
}
