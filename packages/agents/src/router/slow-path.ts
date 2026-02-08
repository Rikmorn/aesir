/**
 * Slow-Path Router
 *
 * Agentic loop routing for ambiguous events that don't match any
 * deterministic routing rule. Uses runAgentLoop() with conversation-based
 * tools to classify events via LLM reasoning.
 *
 * The LLM reads the event, reasons about intent, and calls the appropriate
 * routing tool. Tool calls ARE the routing decision -- the LLM doesn't
 * return structured JSON; it acts by calling tools.
 *
 * Called when EventRouter returns slow_path. The top-level router.ts
 * handles the dispatch.
 */

import type { NormalizedEvent } from "@aesir/types";
import { runAgentLoop } from "../shared/agent-loop/index.js";
import { ROUTER_SYSTEM_PROMPT } from "./system-prompt.js";
import { createQueryConversationsTool } from "./tools/query-conversations.js";
import { createReopenConversationTool } from "./tools/reopen-conversation.js";
import { createSendMessageTool } from "./tools/send-message.js";
import { createSignalConversationTool } from "./tools/signal-conversation.js";
import { createStartConversationTool } from "./tools/start-conversation.js";
import type { EventRouterDeps, RouteResult } from "./types.js";

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
// Slow-Path Router (Conversation-based)
// ---------------------------------------------------------------------------

/**
 * Route an event via the conversation-based LLM agentic loop.
 *
 * Creates conversation-based router tools from factory functions,
 * formats the event for the LLM, and runs runAgentLoop with the
 * Haiku model and a 10-iteration limit.
 *
 * The LLM's tool calls constitute the routing decision:
 * - signal_conversation -> route to existing conversation
 * - start_conversation -> start new conversation
 * - send_message -> send system alert notification
 * - query_conversations -> gather info before deciding
 *
 * @param event - The normalized event to route
 * @param deps - Event router dependencies (ConversationExecutor, logger)
 * @returns RouteResult indicating routing outcome
 */
export async function routeViaAgentLoopV2(
  event: NormalizedEvent,
  deps: EventRouterDeps,
): Promise<RouteResult> {
  const { logger } = deps;

  // Create conversation-based router tools
  const routerTools = [
    createQueryConversationsTool(deps),
    createStartConversationTool(deps),
    createSignalConversationTool(deps),
    createReopenConversationTool(deps),
    createSendMessageTool(deps),
  ];

  // Format the event for the LLM
  const formattedEvent = formatEventForLLM(event);

  logger.info(
    { eventId: event.id, eventType: event.type },
    "Slow-path: routing via LLM agent loop (conversation-based)",
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
