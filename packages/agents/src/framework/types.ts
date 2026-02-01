/**
 * Framework Types
 *
 * Interfaces and types for the v2.3 unified agent framework.
 * EventLog and SessionProjection interfaces defined here;
 * implementations live in separate modules (event-log.ts, session-projection.ts).
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentSession,
  NewAgentEvent,
} from "../shared/db/schema.js";

export { agentEventTypeValues } from "../shared/db/schema.js";

// Re-export for convenience
export type { AgentEvent, AgentEventType, AgentSession, NewAgentEvent };

// ─── Event Append Input ──────────────────────────────────────────────────────

/**
 * Input for EventLog.append(). Omits auto-generated fields.
 * The caller provides the event content; EventLog adds id, sequence, timestamp.
 */
export interface AppendEventInput {
  conversationId: string;
  agentDefinitionId: string;
  agentDefinitionVersion: string;
  agentInstanceId: string;
  parentInstanceId?: string | null;
  type: AgentEventType;
  payload?: Record<string, unknown>;
  tokenCountInput?: number | null;
  tokenCountOutput?: number | null;
  durationMs?: number | null;
}

// ─── Event Query ─────────────────────────────────────────────────────────────

export interface EventQueryOptions {
  /** Filter by event types */
  types?: AgentEventType[];
  /** Return events with sequence > afterSequence */
  afterSequence?: number;
  /** Maximum number of events to return */
  limit?: number;
}

// ─── Event Subscription ──────────────────────────────────────────────────────

export interface EventSubscriptionFilter {
  /** Only receive events of these types (empty = all types) */
  types?: AgentEventType[];
}

/** Async handler called when a matching event is appended */
export type EventSubscriptionHandler = (event: AgentEvent) => Promise<void>;

/** Function to unsubscribe (returned by EventLog.subscribe) */
export type Unsubscribe = () => void;

// ─── EventLog Interface ──────────────────────────────────────────────────────

export interface EventLogOptions {
  /** Database client for batch inserts and queries */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
  /** Flush interval in milliseconds (default: 1000) */
  flushIntervalMs?: number;
  /** Maximum buffer size before eager flush (default: 100) */
  maxBufferSize?: number;
  /** Maximum payload size in bytes before truncation (default: 10240) */
  maxPayloadBytes?: number;
}

/**
 * EventLog - Append-only event recording with buffered writes.
 *
 * - append() is synchronous (void) to avoid blocking the agent loop
 * - Events are buffered and flushed at configurable intervals
 * - flush() forces immediate persistence (call at lifecycle boundaries)
 * - subscribe() enables reactive patterns (e.g., SessionProjection)
 * - Gapless per-conversation sequences assigned automatically
 */
export interface EventLog {
  /**
   * Append an event to the log. Synchronous -- does NOT wait for persistence.
   * Assigns gapless sequence number automatically.
   * Notifies subscribers immediately (in-memory, before persistence).
   */
  append(event: AppendEventInput): void;

  /**
   * Query persisted events for a conversation.
   * Flushes pending buffer first to ensure consistency.
   */
  query(
    conversationId: string,
    options?: EventQueryOptions,
  ): Promise<AgentEvent[]>;

  /**
   * Subscribe to events matching a filter.
   * Handler is called synchronously (in-memory) when append() is called.
   * Returns an unsubscribe function.
   */
  subscribe(
    filter: EventSubscriptionFilter,
    handler: EventSubscriptionHandler,
  ): Unsubscribe;

  /**
   * Initialize the sequence counter for a conversation from the database.
   * MUST be called before the first append() for a conversation.
   * Typically called when handling agent.started events.
   */
  initSequence(conversationId: string): Promise<void>;

  /**
   * Force immediate flush of all buffered events to the database.
   * Call at lifecycle boundaries (pause, complete, fail).
   */
  flush(): Promise<void>;

  /**
   * Close the EventLog, flushing remaining events and clearing timers.
   * Call during graceful shutdown.
   */
  close(): Promise<void>;
}

// ─── SessionProjection Interface ─────────────────────────────────────────────

/**
 * Artifact extraction config: maps tool names to artifact extractors.
 * When a tool.succeeded event matches a tool name in this map,
 * the specified field from the event payload is extracted as an artifact.
 *
 * Example: new Map([
 *   ["create_pull_request", { artifactKey: "pr_url", payloadPath: "url" }],
 *   ["create_branch", { artifactKey: "branch_name", payloadPath: "branch" }],
 * ])
 *
 * In Phase 38, this config comes from the ToolRegistry. For Phase 37,
 * it is passed as a constructor parameter.
 */
export type ArtifactExtractionConfig = Map<string, ArtifactExtractor>;

export interface ArtifactExtractor {
  /** The key to use when storing the artifact in agent_sessions.artifacts */
  artifactKey: string;
  /** The path in the event payload to extract the value from (dot notation) */
  payloadPath: string;
}

export interface SessionProjectionOptions {
  /** Database client for agent_sessions upserts */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
  /** EventLog to subscribe to */
  eventLog: EventLog;
  /** Artifact extraction configuration */
  artifactConfig: ArtifactExtractionConfig;
}

/**
 * SessionProjection - Reactively updates agent_sessions from events.
 *
 * Subscribes to EventLog lifecycle events (agent.started, agent.completed, etc.)
 * and tool.succeeded events. Upserts agent_sessions with current status, timing,
 * and extracted artifacts.
 */
export interface SessionProjection {
  /**
   * Get the current session for a conversation.
   */
  getSession(conversationId: string): Promise<AgentSession | null>;

  /**
   * Stop listening for events and clean up.
   */
  close(): void;
}
