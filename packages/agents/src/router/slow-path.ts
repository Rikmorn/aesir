/**
 * Slow-Path Router
 *
 * Agentic loop routing for ambiguous events that don't match any
 * deterministic fast-path rule. Uses runAgentLoop() with router-specific
 * tools to classify events via LLM reasoning.
 *
 * The LLM reads the event, reasons about intent, and calls the appropriate
 * routing tool. Tool calls ARE the routing decision -- the LLM doesn't
 * return structured JSON; it acts by calling tools.
 *
 * Called AFTER the fast path returns null. The top-level router.ts
 * (Plan 03) handles the fast/slow dispatch.
 */

import type { NormalizedEvent } from "@aesir/types";
import { runAgentLoop } from "../shared/agent-loop/index.js";
import { ROUTER_SYSTEM_PROMPT } from "./system-prompt.js";
import { createQueryWorkflowsTool } from "./tools/query-workflows.js";
import { createSendMessageTool } from "./tools/send-message.js";
import { createSignalWorkflowTool } from "./tools/signal-workflow.js";
import { createStartWorkflowTool } from "./tools/start-workflow.js";
import type { RouteResult, RouterDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Event Formatting
// ---------------------------------------------------------------------------

/**
 * Format a NormalizedEvent for the LLM's initial message.
 *
 * Produces a human-readable summary of the event with structured fields
 * and the full payload as JSON for the LLM to reason about.
 *
 * Exported for testability.
 *
 * @param event - The normalized event to format
 * @returns Formatted string for the LLM's initial message
 */
export function formatEventForLLM(event: NormalizedEvent): string {
  return `Route this event:

Event ID: ${event.id}
Type: ${event.type}
Source: ${event.source}
Timestamp: ${event.timestamp}

Payload:
${JSON.stringify(event.payload, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Slow-Path Router
// ---------------------------------------------------------------------------

/**
 * Route an event via the LLM agentic loop.
 *
 * Creates router tools from factory functions, formats the event for the LLM,
 * and runs runAgentLoop with the Haiku model and a 10-iteration limit.
 *
 * The LLM's tool calls constitute the routing decision:
 * - signal_workflow -> route to existing workflow
 * - start_workflow -> start new workflow
 * - send_message -> send clarification/notification
 * - query_running_workflows -> gather info before deciding
 *
 * @param event - The normalized event to route
 * @param deps - Router dependencies (Temporal client, logger)
 * @returns RouteResult indicating routing outcome
 */
export async function routeViaAgentLoop(
  event: NormalizedEvent,
  deps: RouterDeps,
): Promise<RouteResult> {
  const { logger } = deps;

  // Create router tools from factory functions
  const routerTools = [
    createQueryWorkflowsTool(deps),
    createStartWorkflowTool(deps),
    createSignalWorkflowTool(deps),
    createSendMessageTool(deps),
  ];

  // Format the event for the LLM
  const formattedEvent = formatEventForLLM(event);

  logger.info(
    { eventId: event.id, eventType: event.type },
    "Slow-path: routing via LLM agent loop",
  );

  // Run the agentic loop with Haiku (fast, cheap model for routing)
  const result = await runAgentLoop({
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    tools: routerTools,
    initialMessage: formattedEvent,
    model: "claude-haiku-4-5-20251001",
    maxIterations: 10,
    logger,
    onToolCall: (call) =>
      logger.info(
        { toolName: call.name, toolInput: call.input },
        "Router tool call",
      ),
  });

  logger.info(
    {
      eventId: event.id,
      status: result.status,
      toolCallCount: result.toolCallCount,
      tokenCount: result.tokenCount,
    },
    "Slow-path: agent loop completed",
  );

  // Parse result into RouteResult
  if (result.status === "completed" && result.toolCallCount > 0) {
    return {
      status: "routed",
      action: result.output || "LLM routed via tool calls",
    };
  }

  if (result.status === "completed" && result.toolCallCount === 0) {
    return {
      status: "ignored",
      action: result.output || "LLM decided no action needed",
    };
  }

  if (result.status === "max_iterations") {
    logger.warn({ eventId: event.id }, "Slow-path: router hit iteration limit");
    return {
      status: "failed",
      error: "Router hit iteration limit",
    };
  }

  // error or aborted
  logger.error(
    { eventId: event.id, status: result.status, output: result.output },
    "Slow-path: router LLM error",
  );
  return {
    status: "failed",
    error: result.output || "Router LLM error",
  };
}
