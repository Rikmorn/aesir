/**
 * Router Types
 *
 * Type definitions for the smart router that replaces per-agent event handlers
 * with a unified routing layer. The router uses two paths:
 *
 * 1. Fast path: Deterministic rules for unambiguous events (zero-latency)
 * 2. Slow path: LLM-based classification for ambiguous events
 *
 * Types defined here are consumed by fast-path.ts, slow-path (future),
 * and the top-level router entry point.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import type { Client } from "@temporalio/client";
import type { ConversationExecutor, EventRouter } from "../framework/types.js";

// ---------------------------------------------------------------------------
// Router Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the router at startup.
 *
 * Kept minimal: Temporal client for workflow operations,
 * logger for observability, and optional alerts channel for fallback.
 */
export interface RouterDeps {
  /** Temporal client for starting and signaling workflows */
  workflowClient: Client;
  /** Pino logger instance */
  logger: PinoLogger;
  /** Slack channel ID for ROUT-06 fallback alerts (optional) */
  alertsChannel?: string | undefined;
  /** Linear team ID for product-agent workflow starts (optional) */
  linearTeamId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Fast-Path Action Types
// ---------------------------------------------------------------------------

/**
 * Signal an existing Temporal workflow.
 *
 * Used for: approval buttons, PR completion, escalation resolution.
 */
export interface SignalAction {
  type: "signal";
  /** Target workflow ID (e.g., "dev-agent-{issueId}") */
  workflowId: string;
  /** Signal name (matches Temporal signal definition) */
  signal: string;
  /** Signal payload data */
  payload: Record<string, unknown>;
}

/**
 * Start a new Temporal workflow.
 *
 * Used for: agent_session.created (new Linear issue assignment).
 */
export interface StartAction {
  type: "start";
  /** Temporal workflow name to start */
  workflowName: string;
  /** Temporal task queue */
  taskQueue: string;
  /** Workflow ID (must be unique per workflow execution) */
  workflowId: string;
  /** Workflow arguments (passed to workflow function) */
  args: unknown[];
  /** Whether this action needs enrichment before execution */
  needsEnrichment?: boolean | undefined;
  /** Context for enrichment (e.g., issueId to fetch from MCP) */
  enrichmentContext?: Record<string, unknown> | undefined;
}

/**
 * Ignore this event (no action needed).
 *
 * Used for: issue.created, issue.updated (handled by Linear webhooks, not router).
 */
export interface IgnoreAction {
  type: "ignore";
  /** Human-readable reason for ignoring */
  reason: string;
}

/**
 * Discriminated union of all fast-path actions.
 *
 * The "type" field discriminates between variants, enabling
 * exhaustive switch/case handling in executeFastPath.
 */
export type FastPathAction = SignalAction | StartAction | IgnoreAction;

// ---------------------------------------------------------------------------
// Route Result
// ---------------------------------------------------------------------------

/**
 * Result of routing an event.
 *
 * Returned by both fast-path and slow-path execution.
 * Status indicates whether routing succeeded, was ignored, or failed.
 */
export interface RouteResult {
  /** Routing outcome */
  status: "routed" | "ignored" | "failed";
  /** Description of action taken (e.g., "signal:planApproval") */
  action?: string | undefined;
  /** Workflow ID that was started or signaled */
  workflowId?: string | undefined;
  /** Error message if routing failed */
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Routing Rule
// ---------------------------------------------------------------------------

/**
 * A deterministic routing rule for the fast path.
 *
 * Rules are evaluated in order. The first matching rule produces
 * a FastPathAction. If no rule matches, the event falls through
 * to the slow path (LLM classification).
 */
export interface RoutingRule {
  /** Human-readable rule name for logging/debugging */
  name: string;
  /** Predicate: does this event match this rule? */
  match: (event: NormalizedEvent) => boolean;
  /** Action factory: produce the action for a matched event */
  action: (event: NormalizedEvent) => FastPathAction;
}

// ---------------------------------------------------------------------------
// v2.3 Event Router Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for the v2.3 EventRouter and adapted slow-path tools.
 * Replaces RouterDeps (which uses Temporal Client) with ConversationExecutor.
 * Both types coexist until Phase 47 cleanup.
 */
export interface EventRouterDeps {
  /** ConversationExecutor for start/signal/list operations */
  executor: ConversationExecutor;
  /** Pino logger instance */
  logger: PinoLogger;
  /** Slack channel ID for ROUT-06 fallback alerts (optional) */
  alertsChannel?: string | undefined;
  /** Linear team ID for product-agent starts (optional) */
  linearTeamId?: string | undefined;
}

// ---------------------------------------------------------------------------
// v2.3 Route Event Dependencies & Result
// ---------------------------------------------------------------------------

/**
 * Dependencies for the v2.3 adapted routeEvent() function.
 * RouteEventDeps is a superset of EventRouterDeps: includes the
 * EventRouter itself (pre-initialized with loadStartRules() called).
 *
 * TypeScript structural typing means RouteEventDeps satisfies
 * EventRouterDeps -- can pass directly to routeViaAgentLoopV2().
 */
export interface RouteEventDeps {
  /** ConversationExecutor for start/signal operations */
  executor: ConversationExecutor;
  /** EventRouter for routing decisions (must have loadStartRules() called) */
  eventRouter: EventRouter;
  /** Pino logger instance */
  logger: PinoLogger;
  /** Slack channel ID for routing failure alerts (optional) */
  alertsChannel?: string | undefined;
  /** Linear team ID for product-agent starts (optional) */
  linearTeamId?: string | undefined;
}

/**
 * Result returned by routeEvent(). Used as HTTP response body.
 * Unified 200 for all paths -- webhook callers just need ack.
 */
export interface RouteEventResult {
  /** Always true -- event was received */
  received: true;
  /** What happened */
  action:
    | "started"
    | "signaled"
    | "resumed"
    | "queued"
    | "rejected"
    | "deduplicated"
    | "classifying"
    | "ignored"
    | "error";
  /** Conversation ID when a conversation was started or signaled */
  conversationId?: string;
}
