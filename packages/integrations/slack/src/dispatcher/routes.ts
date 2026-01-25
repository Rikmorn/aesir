/**
 * Slack Event Dispatch Routes
 *
 * Configuration for routing normalized Slack events to agent endpoints.
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
 * message.created: User sent a message, product-agent may engage
 * app_mention.created: User @mentioned the bot, product-agent should respond
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "slack.message.created",
    target: process.env.PRODUCT_AGENT_URL || "http://product-agent:3005/events",
    mode: "async", // Product-agent queues for processing
  },
  {
    eventType: "slack.app_mention.created",
    target: process.env.PRODUCT_AGENT_URL || "http://product-agent:3005/events",
    mode: "sync", // Product-agent should respond promptly
  },
];
