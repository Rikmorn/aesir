/**
 * Router Module
 *
 * v2.3 event routing pipeline: adapter -> EventRouter -> ConversationExecutor.
 * Single entry point for all integration events.
 *
 * Public API:
 * - routeEvent: v2.3 pipeline (adapter -> EventRouter -> ConversationExecutor)
 * - formatEventForLLM / routeViaAgentLoopV2: LLM-based slow path
 * - ROUTER_SYSTEM_PROMPT: LLM system prompt for classification
 * - Types: EventRouterDeps, RouteResult, RouteEventDeps, RouteEventResult
 */

export { routeEvent } from "./router.js";
export { formatEventForLLM, routeViaAgentLoopV2 } from "./slow-path.js";
export { ROUTER_SYSTEM_PROMPT } from "./system-prompt.js";
export type {
  EventRouterDeps,
  RouteEventDeps,
  RouteEventResult,
  RouteResult,
} from "./types.js";
