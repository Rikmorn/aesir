/**
 * Linear Event Dispatch Routes
 *
 * Configuration for routing normalized Linear events to the smart router.
 * All events are sent to a single router endpoint which classifies and
 * routes them to the appropriate agent.
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
 * Linear dispatch routes
 *
 * All events are routed to the smart router for classification.
 * The router decides which agent handles each event based on deterministic
 * rules (fast-path) or LLM classification (slow-path).
 *
 * issue.created: New issue created, router classifies (may start dev-agent workflow)
 * issue.updated: Issue updated, router classifies (may signal dev-agent)
 * agent_session.created: Agent assigned to a task, router routes to dev-agent
 * agent_session.prompted: Human sent a message, router routes to dev-agent
 * comment.created: New comment, router classifies approval intent
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "linear.issue.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "linear.issue.updated",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "linear.agent_session.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "linear.agent_session.prompted",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  {
    eventType: "linear.comment.created",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
];
