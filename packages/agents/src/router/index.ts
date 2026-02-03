/**
 * Router Module
 *
 * Smart event router that combines deterministic fast-path rules
 * with LLM-based slow-path classification. Single entry point for
 * all integration events.
 *
 * Public API:
 * - routeEvent: v2.3 pipeline (adapter -> EventRouter -> ConversationExecutor)
 * - routeEventLegacy: Temporal-based routing (preserved for Phase 47 cleanup)
 * - matchFastPath / executeFastPath: Deterministic rule matching
 * - DETERMINISTIC_RULES: All fast-path rules
 * - routeViaAgentLoop / formatEventForLLM: LLM-based slow path
 * - ROUTER_SYSTEM_PROMPT: LLM system prompt for classification
 * - Types: RouterDeps, RouteResult, RouteEventDeps, RouteEventResult, FastPathAction, RoutingRule
 */

export {
  DETERMINISTIC_RULES,
  executeFastPath,
  matchFastPath,
} from "./fast-path.js";
export { routeEvent, routeEventLegacy } from "./router.js";
export { formatEventForLLM, routeViaAgentLoop } from "./slow-path.js";
export { ROUTER_SYSTEM_PROMPT } from "./system-prompt.js";
export type {
  EventRouterDeps,
  FastPathAction,
  RouteEventDeps,
  RouteEventResult,
  RouteResult,
  RouterDeps,
  RoutingRule,
} from "./types.js";
