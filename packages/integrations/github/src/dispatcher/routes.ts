/**
 * GitHub Event Dispatch Routes
 *
 * Configuration for routing normalized GitHub events to agent endpoints.
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
 * pull_request.review_submitted: PR got a review, dev-agent should handle feedback
 * pull_request.merged: PR was merged, dev-agent should clean up
 */
export const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "github.pull_request.review_submitted",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "sync", // Dev-agent may process immediately
  },
  {
    eventType: "github.pull_request.review_approved",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "sync",
  },
  {
    eventType: "github.pull_request.review_changes_requested",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "sync",
  },
  {
    eventType: "github.pull_request.review_commented",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "async",
  },
  {
    eventType: "github.pull_request.review_dismissed",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "async",
  },
  {
    eventType: "github.pull_request.merged",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "async", // Cleanup can be background
  },
  {
    eventType: "github.pull_request.closed",
    target: process.env.DEV_AGENT_URL || "http://dev-agent:3004/events",
    mode: "async", // PR closed without merge - cleanup can be background
  },
];
