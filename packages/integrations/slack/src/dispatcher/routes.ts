/**
 * Slack Event Dispatch Routes
 *
 * Configuration for routing normalized Slack events to the smart router.
 * All events are sent to a single router endpoint which classifies and
 * routes them to the appropriate agent (dev-agent or product-agent).
 *
 * Type-only matching for v2.1 (no payload field filters).
 */

export interface DispatchRoute {
  /** Event type to match (exact match) */
  eventType: string;
  /** Target URL for dispatch */
  target: string;
  /** Dispatch mode: async (5s timeout) or sync (30s timeout) */
  mode: "async" | "sync";
}

/**
 * Slack dispatch routes
 *
 * All events are routed to the smart router for classification.
 * The router decides which agent (dev-agent or product-agent) handles each event.
 *
 * message.created: User sent a message, router classifies intent
 * app_mention.created: User @mentioned the bot, router classifies intent
 * block_actions.approved: User approved plan via button, router routes to dev-agent
 * block_actions.rejected: User rejected plan via button, router routes to dev-agent
 * block_actions.escalation_retry: User chose to retry after escalation, router routes to dev-agent
 * block_actions.escalation_abort: User chose to abort after escalation, router routes to dev-agent
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "slack.message.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async", // Router queues for classification
  },
  {
    eventType: "slack.app_mention.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync", // Router should classify and respond promptly
  },
  {
    eventType: "slack.block_actions.approved",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync", // Quick approval processing via router fast-path
  },
  {
    eventType: "slack.block_actions.rejected",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync", // Quick rejection processing via router fast-path
  },
  {
    eventType: "slack.block_actions.escalation_retry",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync", // Escalation retry via router fast-path
  },
  {
    eventType: "slack.block_actions.escalation_abort",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync", // Escalation abort via router fast-path
  },
];
