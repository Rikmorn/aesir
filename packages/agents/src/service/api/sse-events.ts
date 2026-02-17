/**
 * SSE Events Handler
 *
 * GET /api/sse/events -- Server-Sent Events endpoint that streams
 * real-time agent events to connected clients.
 *
 * Features:
 * - Connection limit (default 50) with 429 response
 * - Query param filtering: ?conversationId=xxx&types=tool.called,tool.failed
 * - SSE protocol: id, event, data fields with retry interval
 * - Last-Event-ID replay from bounded event buffer
 * - Gap detection when requested events have expired from buffer
 * - Keepalive pings every 20 seconds
 * - Clean disconnect handling with EventLog unsubscribe
 * - Graceful shutdown via SseConnectionManager.closeAll()
 *
 * Architecture:
 * - One global EventLog subscription populates the shared EventBuffer (for replay)
 * - Per-connection EventLog subscriptions write SSE events (with client-specific filters)
 */

import type { PinoLogger } from "@aesir/platform";
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  type AgentEventType,
  agentEventTypeValues,
  type EventLog,
  type Unsubscribe,
} from "../../framework/types.js";
import {
  type BufferedEvent,
  createEventBuffer,
  type EventBuffer,
} from "./event-buffer.js";
import { sendApiError } from "./middleware.js";
import { ErrorCodes } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Manages active SSE connections for health monitoring and graceful shutdown.
 */
export interface SseConnectionManager {
  /** Number of currently active SSE connections. */
  getConnectionCount(): number;
  /** Close all active SSE connections and clean up resources. */
  closeAll(): void;
}

export interface SseEventsRouterOptions {
  /** EventLog to subscribe to for real-time event delivery */
  eventLog: EventLog;
  /** Logger instance */
  logger: PinoLogger;
  /** Maximum concurrent SSE connections (default: 50) */
  maxConnections?: number;
  /** Keepalive ping interval in milliseconds (default: 20_000) */
  keepaliveIntervalMs?: number;
  /** Maximum events to retain in replay buffer (default: 1000) */
  bufferSize?: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

/** Tracked state for each active SSE connection */
interface ConnectionState {
  /** The Express Response being written to */
  res: Response;
  /** Per-connection EventLog unsubscribe function */
  unsubscribe: Unsubscribe;
  /** Keepalive interval ID */
  keepaliveInterval: ReturnType<typeof setInterval>;
  /** Whether the connection has been closed (prevents writes after close) */
  closed: boolean;
}

// ─── Query Validation ─────────────────────────────────────────────────────────

const querySchema = z.object({
  conversationId: z.string().optional(),
  types: z.string().optional(),
});

const agentEventTypeSet = new Set<string>(agentEventTypeValues);

// ─── SSE Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the SSE data payload from an AgentEvent.
 * Maps snake_case DB fields to camelCase for the dashboard API contract.
 */
function buildEventPayload(event: {
  id: string;
  conversation_id: string;
  agent_definition_id: string;
  agent_instance_id: string;
  parent_instance_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  sequence: number;
  timestamp: Date;
  token_count_input: number | null;
  token_count_output: number | null;
  duration_ms: number | null;
}): Record<string, unknown> {
  return {
    id: event.id,
    conversationId: event.conversation_id,
    agentDefinitionId: event.agent_definition_id,
    agentInstanceId: event.agent_instance_id,
    parentInstanceId: event.parent_instance_id,
    type: event.type,
    payload: event.payload,
    sequence: event.sequence,
    timestamp: event.timestamp,
    tokenCountInput: event.token_count_input,
    tokenCountOutput: event.token_count_output,
    durationMs: event.duration_ms,
  };
}

/**
 * Write a single SSE event to the response stream.
 */
function writeSseEvent(
  res: Response,
  id: string,
  eventType: string,
  data: unknown,
): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the SSE events router and connection manager.
 *
 * Returns both the Express Router (mounted at /api/sse/events) and the
 * SseConnectionManager (used by main.ts for graceful shutdown).
 */
export function createSseEventsRouter(options: SseEventsRouterOptions): {
  router: Router;
  manager: SseConnectionManager;
} {
  const {
    eventLog,
    logger,
    maxConnections = 50,
    keepaliveIntervalMs = 20_000,
    bufferSize = 1000,
  } = options;

  const connections = new Map<Response, ConnectionState>();
  const eventBuffer: EventBuffer = createEventBuffer(bufferSize);

  // ─── Global Buffer Subscription ─────────────────────────────────────
  // Single subscription that populates the EventBuffer for replay.
  // Created once at router initialization, not per-connection.

  const globalUnsubscribe = eventLog.subscribe({}, async (event) => {
    const payload = buildEventPayload(event);
    const bufferedEvent: BufferedEvent = {
      id: String(event.sequence),
      sequence: event.sequence,
      type: event.type,
      conversationId: event.conversation_id,
      data: payload,
    };
    eventBuffer.push(bufferedEvent);
  });

  // ─── Router ─────────────────────────────────────────────────────────

  const router = Router();

  router.get("/", (req, res) => {
    // 1. Connection limit check
    if (connections.size >= maxConnections) {
      sendApiError(
        res,
        429,
        ErrorCodes.TOO_MANY_CONNECTIONS,
        "Maximum SSE connections reached",
      );
      return;
    }

    // 2. Parse and validate query params
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendApiError(
        res,
        400,
        ErrorCodes.VALIDATION_ERROR,
        "Invalid query parameters",
        queryResult.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
      return;
    }

    const { conversationId, types: typesParam } = queryResult.data;

    // Validate event types if provided
    let typeFilter: AgentEventType[] | undefined;
    if (typesParam) {
      const requestedTypes = typesParam.split(",").map((t) => t.trim());
      const invalidTypes = requestedTypes.filter(
        (t) => !agentEventTypeSet.has(t),
      );
      if (invalidTypes.length > 0) {
        sendApiError(
          res,
          400,
          ErrorCodes.VALIDATION_ERROR,
          `Invalid event types: ${invalidTypes.join(", ")}`,
          invalidTypes.map((t) => ({
            type: t,
            message: `"${t}" is not a valid agent event type`,
          })),
        );
        return;
      }
      typeFilter = requestedTypes as AgentEventType[];
    }

    // 3. Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    // 4. Send retry interval
    res.write("retry: 3000\n\n");

    // Track closed state to prevent writes after disconnect
    let closed = false;

    // 5. Handle Last-Event-ID replay
    const lastEventId = req.headers["last-event-id"];
    if (lastEventId) {
      const lastSeq = Number.parseInt(lastEventId as string, 10);
      if (!Number.isNaN(lastSeq)) {
        const oldestSeq = eventBuffer.getOldestSequence();

        // Gap detection: if requested sequence is older than buffer
        if (oldestSeq !== null && lastSeq < oldestSeq) {
          res.write(
            'event: gap\ndata: {"reason":"Events expired from buffer, consider full refresh"}\n\n',
          );
        }

        // Replay buffered events matching client filters
        const missed = eventBuffer.getAfter(lastSeq);
        for (const buffered of missed) {
          // Apply conversationId filter
          if (conversationId && buffered.conversationId !== conversationId) {
            continue;
          }
          // Apply types filter
          if (
            typeFilter &&
            !typeFilter.includes(buffered.type as AgentEventType)
          ) {
            continue;
          }
          writeSseEvent(res, buffered.id, buffered.type, buffered.data);
        }
      }
    }

    // 6. Subscribe to EventLog for real-time events
    const subscriptionFilter = typeFilter ? { types: typeFilter } : {};
    const unsubscribe = eventLog.subscribe(
      subscriptionFilter,
      async (event) => {
        if (closed) return;

        // Apply conversationId filter (EventLog only filters by type)
        if (conversationId && event.conversation_id !== conversationId) {
          return;
        }

        const payload = buildEventPayload(event);
        writeSseEvent(res, String(event.sequence), event.type, payload);
      },
    );

    // 7. Keepalive ping
    const keepaliveInterval = setInterval(() => {
      if (closed) return;
      res.write(": ping\n\n");
    }, keepaliveIntervalMs);

    // 8. Track connection
    const connectionState: ConnectionState = {
      res,
      unsubscribe,
      keepaliveInterval,
      closed: false,
    };
    connections.set(res, connectionState);

    logger.debug(
      {
        connectionCount: connections.size,
        conversationId: conversationId ?? "all",
        types: typeFilter ?? "all",
      },
      "SSE client connected",
    );

    // 9. Cleanup on disconnect
    req.on("close", () => {
      closed = true;
      connectionState.closed = true;
      unsubscribe();
      clearInterval(keepaliveInterval);
      connections.delete(res);
      logger.debug(
        { connectionCount: connections.size },
        "SSE client disconnected",
      );
    });
  });

  // ─── Connection Manager ─────────────────────────────────────────────

  const manager: SseConnectionManager = {
    getConnectionCount(): number {
      return connections.size;
    },

    closeAll(): void {
      // Unsubscribe the global buffer subscription
      globalUnsubscribe();

      // Close all active connections
      for (const [res, state] of connections) {
        state.closed = true;
        state.unsubscribe();
        clearInterval(state.keepaliveInterval);
        res.end();
      }
      connections.clear();

      logger.info("All SSE connections closed");
    },
  };

  return { router, manager };
}
