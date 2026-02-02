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
import {
  ROUTER_SYSTEM_PROMPT,
  ROUTER_SYSTEM_PROMPT_V2,
} from "./system-prompt.js";
import { createQueryConversationsTool } from "./tools/query-conversations.js";
import { createQueryWorkflowsTool } from "./tools/query-workflows.js";
import { createSendMessageTool } from "./tools/send-message.js";
import { createSignalConversationTool } from "./tools/signal-conversation.js";
import { createSignalWorkflowTool } from "./tools/signal-workflow.js";
import { createStartConversationTool } from "./tools/start-conversation.js";
import { createStartWorkflowTool } from "./tools/start-workflow.js";
import type { EventRouterDeps, RouteResult, RouterDeps } from "./types.js";

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

// ---------------------------------------------------------------------------
// v2.3 Slow-Path Router (Conversation-based)
// ---------------------------------------------------------------------------

/**
 * Route an event via the v2.3 conversation-based LLM agentic loop.
 *
 * Adapted from routeViaAgentLoop with these changes:
 * - Uses conversation-based tools (start_conversation, signal_conversation,
 *   query_conversations) instead of Temporal-based tools
 * - Uses ROUTER_SYSTEM_PROMPT_V2 with domain-language signal types
 * - Takes EventRouterDeps (ConversationExecutor) instead of RouterDeps (Temporal Client)
 *
 * Both this function and routeViaAgentLoop coexist until Phase 47 cleanup.
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

  // Create v2.3 conversation-based router tools
  // Note: createSendMessageTool accepts RouterDeps but doesn't use any deps
  // fields (it calls callMcpTool directly). Safe to cast since _deps is unused.
  const routerTools = [
    createQueryConversationsTool(deps),
    createStartConversationTool(deps),
    createSignalConversationTool(deps),
    createSendMessageTool(deps as unknown as RouterDeps),
  ];

  // Format the event for the LLM (same formatting as v1)
  const formattedEvent = formatEventForLLM(event);

  logger.info(
    { eventId: event.id, eventType: event.type },
    "Slow-path v2: routing via LLM agent loop (conversation-based)",
  );

  // Run the agentic loop with Haiku (fast, cheap model for routing)
  const result = await runAgentLoop({
    systemPrompt: ROUTER_SYSTEM_PROMPT_V2,
    tools: routerTools,
    initialMessage: formattedEvent,
    model: "claude-haiku-4-5-20251001",
    maxIterations: 10,
    logger,
    onToolCall: (call) =>
      logger.info(
        { toolName: call.name, toolInput: call.input },
        "Router v2 tool call",
      ),
  });

  logger.info(
    {
      eventId: event.id,
      status: result.status,
      toolCallCount: result.toolCallCount,
      tokenCount: result.tokenCount,
    },
    "Slow-path v2: agent loop completed",
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
    logger.warn(
      { eventId: event.id },
      "Slow-path v2: router hit iteration limit",
    );
    return {
      status: "failed",
      error: "Router hit iteration limit",
    };
  }

  // error or aborted
  logger.error(
    { eventId: event.id, status: result.status, output: result.output },
    "Slow-path v2: router LLM error",
  );
  return {
    status: "failed",
    error: result.output || "Router LLM error",
  };
}
