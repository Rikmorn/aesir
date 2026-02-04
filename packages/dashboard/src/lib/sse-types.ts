/**
 * SSE Event Types
 *
 * Shared type definitions for the SSE real-time event system.
 * Used by EventStreamStore, useEventStream hook, and live components.
 *
 * SseEvent shape matches the agent-service buildEventPayload() output
 * (packages/agents/src/service/api/sse-events.ts).
 */

// ─── Connection Status ──────────────────────────────────────────────────────

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

// ─── SSE Event Payload ──────────────────────────────────────────────────────

/**
 * SSE event payload matching the agent-service buildEventPayload() output.
 * Fields are camelCase (mapped from snake_case DB columns by the SSE endpoint).
 */
export interface SseEvent {
  id: string;
  conversationId: string;
  agentDefinitionId: string;
  type: string;
  payload: Record<string, unknown>;
  sequence: number;
  timestamp: string;
  tokenCountInput: number | null;
  tokenCountOutput: number | null;
  durationMs: number | null;
}

// ─── Event Stream State ─────────────────────────────────────────────────────

/**
 * Snapshot of the event stream state exposed to React via useSyncExternalStore.
 */
export interface EventStreamState {
  events: SseEvent[];
  status: ConnectionStatus;
  lastEventId: string | null;
  /** True when the server sent a "gap" event indicating missed events */
  hasGap: boolean;
}

// ─── Event Type Constants ───────────────────────────────────────────────────

/** Lifecycle events for conversations list and overview pages */
export const LIFECYCLE_EVENT_TYPES = [
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
] as const;

/** All event types for conversation detail page */
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
