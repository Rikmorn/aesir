/**
 * Core Router
 *
 * v2.3 unified event routing pipeline:
 *   adapter pipeline -> EventRouter.handle() -> ConversationExecutor
 *
 * routeEvent() is the single entry point for all integration events.
 * It transforms NormalizedEvent -> IncomingEvent via adapters, routes
 * via EventRouter, and dispatches to ConversationExecutor.start()/signal().
 */

import type { NormalizedEvent } from "@aesir/types";
import { ALL_ADAPTERS } from "../adapters/index.js";
import { adaptPassThrough } from "../adapters/pass-through.js";
import { callMcpTool } from "../shared/mcp/index.js";
import { enrichInitialMessage } from "./enrichment.js";
import { routeViaAgentLoopV2 } from "./slow-path.js";
import type { RouteEventDeps, RouteEventResult } from "./types.js";

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
  let incomingEvent = null;
  for (const adapter of ALL_ADAPTERS) {
    incomingEvent = adapter(event);
    if (incomingEvent !== null) break;
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
        // Fire-and-forget: return 200 immediately, process in background
        void routeViaAgentLoopV2(event, deps).catch((error) => {
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
