/**
 * Core Router
 *
 * v2.3 unified event routing pipeline:
 *   adapter pipeline -> [task routing] -> EventRouter.handle() -> ConversationExecutor
 *
 * routeEvent() is the single entry point for all integration events.
 * It transforms NormalizedEvent -> IncomingEvent via adapters, optionally
 * routes through the task-aware path (Phase 58.4), then routes via
 * EventRouter and dispatches to ConversationExecutor.start()/signal().
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { sql } from "drizzle-orm";
import { ALL_ADAPTERS } from "../adapters/index.js";
import { adaptPassThrough } from "../adapters/pass-through.js";
import type { IncomingEvent } from "../adapters/types.js";
import { isAdapterIgnore } from "../adapters/types.js";
import { callMcpTool } from "../shared/mcp/index.js";
import { enrichInitialMessage } from "./enrichment.js";
import { routeViaAgentLoopV2 } from "./slow-path.js";
import type { RouteEventDeps, RouteEventResult } from "./types.js";

// ---------------------------------------------------------------------------
// Task-Aware Routing (Phase 58.4)
// ---------------------------------------------------------------------------

/**
 * Route an event through the task-aware path.
 *
 * Uses a PostgreSQL advisory lock (pg_advisory_xact_lock) to serialize
 * routing decisions for the same task, preventing duplicate conversation
 * creation from concurrent events.
 *
 * Returns RouteEventResult on success, or null to signal fall-through
 * to EventRouter. Caller catches thrown errors and falls through.
 *
 * Per CONTEXT.md locked decisions:
 * - Signal types preserved (task routing changes destination, not identity)
 * - Signal payload identical to non-task-routed signals
 * - All three active statuses (running, waiting, queued) = "active"
 * - Do NOT check task status -- terminal tasks still receive events
 * - Non-agent assignees fall through to EventRouter
 * - CorrelationKey: ${taskId}:${event.deduplicationId || event.type}
 */
async function routeViaTask(
  event: IncomingEvent,
  deps: RouteEventDeps,
  logger: PinoLogger,
): Promise<RouteEventResult | null> {
  // Caller guarantees these are defined via the guard:
  //   if (incomingEvent.taskId && deps.taskService && deps.db)
  const taskId = event.taskId as string;
  const db = deps.db as NonNullable<typeof deps.db>;
  const taskService = deps.taskService as NonNullable<typeof deps.taskService>;

  return await db.transaction(async (tx) => {
    // 1. Advisory lock: serialize events for same task
    // Uses hashtext() (PG built-in) to convert string to integer lock key.
    // Transaction-scoped: auto-released on commit/rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`);

    // 2. Look up task
    const task = await taskService.get(taskId);
    if (!task) {
      logger.warn({ taskId }, "Task not found during task routing");
      return null; // Fall through, caller strips taskId
    }

    // 3. Guard: agent assignee only
    // Per CONTEXT.md: "If assignee_type !== 'agent': fall through to EventRouter"
    if (task.assignee_type !== "agent") {
      logger.info(
        { taskId, assigneeType: task.assignee_type },
        "Task has non-agent assignee, falling through to EventRouter",
      );
      return null;
    }

    // 4. Find active conversation for this task
    const activeConv = await deps.executor.findActiveForTask(taskId);

    if (activeConv) {
      // 5a. Deliver as signal to existing conversation
      // Per CONTEXT.md: preserve original signal types, no task metadata enrichment
      const signal = {
        type: event.type,
        data: event.data,
        message: event.message,
        source: event.source,
        deduplicationId: event.deduplicationId,
        ...(event.replyContext && { replyContext: event.replyContext }),
      };

      logger.info(
        { taskId, conversationId: activeConv.id, signalType: signal.type },
        "Task routing: signaling active conversation",
      );

      const signalResult = await deps.executor.signal(activeConv.id, signal);
      return {
        received: true,
        action: signalResult.action,
        conversationId: activeConv.id,
      };
    }

    // 5b. No active conversation: create new one
    // Per CONTEXT.md: agent definition from task.assignee_id
    const agentDefinitionId = task.assignee_id;
    // Per CONTEXT.md: correlationKey = ${taskId}:${event.deduplicationId || event.type}
    const correlationKey = `${taskId}:${event.deduplicationId || event.type}`;
    // Per CONTEXT.md: context enrichment via shared helper (same as existing start path)
    const initialMessage = enrichInitialMessage(event, deps);

    logger.info(
      { taskId, agentDefinitionId, correlationKey },
      "Task routing: creating new conversation",
    );

    // Per CONTEXT.md: executor.start() sets task_id directly on INSERT
    const conversationId = await deps.executor.start({
      agentDefinitionId,
      correlationKey,
      initialMessage,
      taskId,
      ...(event.replyContext && { replyContext: event.replyContext }),
    });

    return { received: true, action: "started", conversationId };
  });
}

// ---------------------------------------------------------------------------
// v2.3 Core Routing Function
// ---------------------------------------------------------------------------

/**
 * Route an event through the v2.3 adapter -> EventRouter -> executor pipeline.
 *
 * 1. Runs adapter pipeline (ALL_ADAPTERS then adaptPassThrough fallback)
 * 2. Calls EventRouter.handle() for deterministic routing decision
 * 3. Dispatches: start -> executor.start(), signal -> executor.signal(),
 *    slow_path -> fire-and-forget routeViaAgentLoopV2(), ignore -> no-op
 *
 * Returns unified result for HTTP 200 response. Webhook callers just need ack.
 *
 * IMPORTANT: No MCP enrichment. Agents fetch their own context via tools.
 *
 * @param event - Normalized event from integration dispatcher
 * @param deps - Router dependencies (executor, eventRouter, logger)
 * @returns RouteEventResult for HTTP response body
 */
export async function routeEvent(
  event: NormalizedEvent,
  deps: RouteEventDeps,
): Promise<RouteEventResult> {
  const eventLogger = deps.logger.child({
    eventId: event.id,
    eventType: event.type,
    source: event.source,
  });

  eventLogger.info("Routing event");

  // 1. Adapter pipeline: first non-null wins, pass-through as fallback
  let incomingEvent: IncomingEvent | null = null;
  for (const adapter of ALL_ADAPTERS) {
    const result = adapter(event);
    if (isAdapterIgnore(result)) {
      eventLogger.debug({ reason: result.reason }, "Event ignored by adapter");
      return { received: true, action: "ignored" };
    }
    if (result !== null) {
      incomingEvent = result;
      break;
    }
  }
  if (incomingEvent === null) {
    incomingEvent = adaptPassThrough(event);
  }

  eventLogger.debug(
    {
      adaptedType: incomingEvent.type,
      correlationKey: incomingEvent.correlationKey,
    },
    "Event adapted",
  );

  // 1.5. Task routing branch (early exit)
  // Per CONTEXT.md: all events with taskId go through task routing regardless of origin
  if (incomingEvent.taskId && deps.taskService && deps.db) {
    try {
      const taskResult = await routeViaTask(incomingEvent, deps, eventLogger);
      if (taskResult !== null) {
        eventLogger.info(
          { taskId: incomingEvent.taskId, action: taskResult.action },
          "Event routed via task",
        );
        return taskResult; // Task routing succeeded -- early exit
      }
      // taskResult === null means fall through to EventRouter
      // Per CONTEXT.md: strip taskId when task lookup fails or non-agent assignee
      incomingEvent = { ...incomingEvent, taskId: undefined };
    } catch (error) {
      // Per CONTEXT.md: advisory lock failure or DB error -> fall through, strip taskId
      eventLogger.warn(
        { err: error, taskId: incomingEvent.taskId },
        "Task routing failed, falling through to EventRouter",
      );
      incomingEvent = { ...incomingEvent, taskId: undefined };
    }
  }

  // 2. EventRouter: deterministic routing decision
  const routeDecision = deps.eventRouter.handle(incomingEvent);

  try {
    // 3. Dispatch based on routing decision
    switch (routeDecision.action) {
      case "start": {
        const initialMessage = enrichInitialMessage(
          routeDecision.event,
          deps,
          routeDecision.message,
        );

        const conversationId = await deps.executor.start({
          agentDefinitionId: routeDecision.agentDefinitionId,
          correlationKey: routeDecision.correlationKey,
          initialMessage,
          ...(routeDecision.event.replyContext && {
            replyContext: routeDecision.event.replyContext,
          }),
        });

        // executor.start() is idempotent (EXEC-10): returns existing ID
        // for same correlationKey. Both new and idempotent starts are
        // logged at info level. Idempotent starts are NOT alerted.
        if (conversationId === routeDecision.conversationId) {
          eventLogger.info({ conversationId }, "Started new conversation");
        } else {
          // executor returned a different ID -- indicates idempotent match
          eventLogger.info(
            { conversationId },
            "Conversation already exists (idempotent start)",
          );
        }

        return { received: true, action: "started", conversationId };
      }

      case "signal": {
        const signalResult = await deps.executor.signal(
          routeDecision.conversationId,
          routeDecision.signal,
        );

        if (signalResult.action === "rejected") {
          eventLogger.warn(
            {
              conversationId: routeDecision.conversationId,
              signalAction: signalResult.action,
            },
            "Signal rejected (conversation in terminal state)",
          );
        } else {
          eventLogger.info(
            {
              conversationId: routeDecision.conversationId,
              signalAction: signalResult.action,
            },
            "Signal delivered",
          );
        }

        return {
          received: true,
          action: signalResult.action,
          conversationId: routeDecision.conversationId,
        };
      }

      case "slow_path": {
        // Thread eventReplyContext from the incoming event into slow-path deps
        // so router tools (signal_conversation, start_conversation) can auto-inject it
        const slowPathDeps = {
          ...deps,
          ...(routeDecision.event.replyContext && {
            eventReplyContext: routeDecision.event.replyContext,
          }),
        };

        // Fire-and-forget: return 200 immediately, process in background
        void routeViaAgentLoopV2(event, slowPathDeps).catch((error) => {
          eventLogger.error(
            { err: error },
            "Background slow-path routing failed",
          );
          void sendRoutingAlertV2(event, deps);
        });

        return { received: true, action: "classifying" };
      }

      case "ignore": {
        eventLogger.debug({ reason: routeDecision.reason }, "Event ignored");
        return { received: true, action: "ignored" };
      }
    }
  } catch (error) {
    return handleRoutingError(event, error, deps);
  }
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

/**
 * Handle a routing error: log, alert, return error result.
 * Only actual infrastructure failures trigger alerts.
 */
function handleRoutingError(
  event: NormalizedEvent,
  error: unknown,
  deps: RouteEventDeps,
): RouteEventResult {
  deps.logger.error(
    { eventId: event.id, eventType: event.type, err: error },
    "Routing error",
  );
  void sendRoutingAlertV2(event, deps);
  return { received: true, action: "error" };
}

/**
 * Send a generic routing alert to the configured Slack channel.
 *
 * Best-effort: alert failures are caught and logged, never thrown.
 * IMPORTANT: No stack traces or detailed error messages in the alert.
 * Ops team uses logs for debugging, not Slack messages.
 */
async function sendRoutingAlertV2(
  event: NormalizedEvent,
  deps: RouteEventDeps,
): Promise<void> {
  if (!deps.alertsChannel) {
    deps.logger.warn(
      { eventId: event.id },
      "No alertsChannel configured, skipping Slack alert for routing failure",
    );
    return;
  }

  // Generic message -- no stack traces, no detailed errors
  const alertMessage = `Something went wrong processing event ${event.type} (${event.id}). Check logs.`;

  try {
    await callMcpTool({
      integration: "slack",
      tool: "send_message",
      params: {
        channel: deps.alertsChannel,
        text: alertMessage,
      },
      agentId: "router",
      correlationId: event.correlationId,
    });

    deps.logger.info(
      { eventId: event.id, channel: deps.alertsChannel },
      "Routing failure alert sent to Slack",
    );
  } catch (alertError) {
    // Best-effort: log but don't throw
    deps.logger.warn(
      { err: alertError, eventId: event.id },
      "Failed to send routing failure alert to Slack (best-effort)",
    );
  }
}
