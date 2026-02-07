/**
 * Router Types
 *
 * Type definitions for the v2.3 event routing pipeline.
 * The router uses adapter -> EventRouter -> ConversationExecutor flow,
 * with an LLM-based slow path for ambiguous events.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ConversationExecutor, EventRouter } from "../framework/types.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type { TaskService } from "../shared/services/task-service.js";

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
// v2.3 Event Router Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for the v2.3 EventRouter and adapted slow-path tools.
 * Uses ConversationExecutor for start/signal/list operations.
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
  /** GitHub owner/org for workspace context (optional) */
  githubOwner?: string | undefined;
  /** GitHub repo name for workspace context (optional) */
  githubRepo?: string | undefined;
  /** GitHub base branch for workspace context (optional, defaults to "main") */
  githubBaseBranch?: string | undefined;
  /** TaskService for task lookup in task-aware routing (Phase 58.4) */
  taskService?: TaskService | undefined;
  /** Database client for advisory lock transactions (Phase 58.4) */
  db?: NodePgDatabase<typeof agentsSchemaModule> | undefined;
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
