/**
 * Core Router
 *
 * Unified event routing that combines fast-path deterministic rules
 * with slow-path LLM-based classification. Every event goes through
 * routeEvent(), which:
 *
 * 1. Tries fast path first (zero LLM latency)
 * 2. Falls back to slow path (LLM agent loop) if no rule matches
 * 3. Handles failures with ROUT-06 (error log + Slack alert, never silently drop)
 *
 * This is the single entry point for all event routing decisions.
 */

import type { NormalizedEvent } from "@aesir/types";
import { callMcpTool } from "../shared/mcp/index.js";
import { executeFastPath, matchFastPath } from "./fast-path.js";
import { routeViaAgentLoop } from "./slow-path.js";
import type { RouteResult, RouterDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Core Routing Function
// ---------------------------------------------------------------------------

/**
 * Route an event through fast-path rules, then slow-path LLM if no match.
 *
 * Implements ROUT-06: events are never silently dropped. If routing fails
 * at any stage, the failure is logged and an alert is sent to the configured
 * Slack channel (best-effort).
 *
 * @param event - Normalized event from integration dispatcher
 * @param deps - Router dependencies (Temporal client, logger, optional alerts channel)
 * @returns RouteResult indicating routing outcome
 */
export async function routeEvent(
  event: NormalizedEvent,
  deps: RouterDeps,
): Promise<RouteResult> {
  const eventLogger = deps.logger.child({
    eventId: event.id,
    eventType: event.type,
    source: event.source,
  });

  eventLogger.info("Routing event");

  // 1. Try fast path first (zero LLM latency)
  const fastAction = matchFastPath(event);

  if (fastAction) {
    eventLogger.info(
      { rule: "fast-path", actionType: fastAction.type },
      "Fast-path match",
    );
    try {
      const result = await executeFastPath(fastAction, deps);
      eventLogger.info({ result }, "Fast-path routing complete");
      return result;
    } catch (error) {
      eventLogger.error({ err: error }, "Fast-path execution failed");
      return handleRoutingFailure(event, deps, error);
    }
  }

  // 2. Slow path: LLM reasoning for ambiguous events
  eventLogger.info("No fast-path match, routing via agentic loop");
  try {
    const result = await routeViaAgentLoop(event, deps);
    eventLogger.info({ result }, "Slow-path routing complete");

    // ROUT-06: If routing failed, alert
    if (result.status === "failed") {
      await sendRoutingAlert(event, deps, result.error || "Unknown failure");
    }

    return result;
  } catch (error) {
    eventLogger.error({ err: error }, "Slow-path routing failed");
    return handleRoutingFailure(event, deps, error);
  }
}

// ---------------------------------------------------------------------------
// Failure Handling (ROUT-06)
// ---------------------------------------------------------------------------

/**
 * Handle a routing failure: log, alert, return failed result.
 *
 * Never throws -- the caller always gets a RouteResult with status "failed".
 * Alert sending is best-effort (errors caught and logged, not re-thrown).
 */
async function handleRoutingFailure(
  event: NormalizedEvent,
  deps: RouterDeps,
  error: unknown,
): Promise<RouteResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  deps.logger.error(
    {
      eventId: event.id,
      eventType: event.type,
      source: event.source,
      err: error,
    },
    `Routing failure: ${errorMessage}`,
  );

  // Best-effort Slack alert
  await sendRoutingAlert(event, deps, errorMessage);

  return {
    status: "failed",
    error: errorMessage,
  };
}

/**
 * Send a routing failure alert to the configured Slack channel.
 *
 * Best-effort: errors from sending the alert itself are caught and logged,
 * never re-thrown. If no alertsChannel is configured, this is a no-op
 * (the error is still logged by the caller).
 */
async function sendRoutingAlert(
  event: NormalizedEvent,
  deps: RouterDeps,
  reason: string,
): Promise<void> {
  if (!deps.alertsChannel) {
    deps.logger.warn(
      { eventId: event.id },
      "No alertsChannel configured, skipping Slack alert for routing failure",
    );
    return;
  }

  const alertMessage = `Router failed to route event: ${event.type} (${event.id}) - ${reason}`;

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
    deps.logger.error(
      { err: alertError, eventId: event.id },
      "Failed to send routing failure alert to Slack (best-effort)",
    );
  }
}
