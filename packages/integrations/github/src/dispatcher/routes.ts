/**
 * GitHub Event Dispatch Routes
 *
 * Configuration for routing normalized GitHub events to the smart router.
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
 * GitHub dispatch routes
 *
 * All events are routed to the smart router for classification.
 * The router uses deterministic rules to route PR review events
 * to dev-agent (fast-path, no LLM needed).
 *
 * pull_request.review_submitted: PR got a review, router routes to dev-agent
 * pull_request.review_approved: PR approved, router signals dev-agent workflow
 * pull_request.review_changes_requested: Changes requested, router signals dev-agent
 * pull_request.review_commented: Review comment, router routes to dev-agent
 * pull_request.review_dismissed: Review dismissed, router routes to dev-agent
 * pull_request.merged: PR merged, router signals dev-agent for cleanup
 * pull_request.closed: PR closed without merge, router signals dev-agent for cleanup
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "github.pull_request.review_submitted",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  {
    eventType: "github.pull_request.review_approved",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  {
    eventType: "github.pull_request.review_changes_requested",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "sync",
  },
  {
    eventType: "github.pull_request.review_commented",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "github.pull_request.review_dismissed",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "github.pull_request.merged",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
  {
    eventType: "github.pull_request.closed",
    target: process.env.ROUTER_URL || "http://router:3006/events",
    mode: "async",
  },
];
