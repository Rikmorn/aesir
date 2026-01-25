/**
 * Linear Event Dispatch Routes
 *
 * Configuration for routing normalized Linear events to agent endpoints.
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
 * agent_session.created: Agent assigned to a task, should start work
 * agent_session.prompted: Human sent a message, agent should respond
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "linear.agent_session.created",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "async",
  },
  {
    eventType: "linear.agent_session.prompted",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "sync",
  },
];
