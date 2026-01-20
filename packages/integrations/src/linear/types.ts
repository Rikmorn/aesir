/**
 * Linear Integration Types
 *
 * Type definitions for Linear OAuth configuration, webhook payloads,
 * and agent session activities. These types support the agent's
 * interaction with Linear's API and webhook system.
 */

/**
 * OAuth configuration for Linear API access
 */
export interface LinearConfig {
  /** OAuth access token for API calls */
  accessToken: string;
  /** OAuth refresh token for token renewal (may be absent if Linear didn't provide one) */
  refreshToken?: string;
  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt: number;
}

/**
 * Base webhook payload fields from Linear
 */
export interface WebhookPayloadBase {
  /** Type of resource that changed */
  type: string;
  /** Resource data */
  data: unknown;
  /** Timestamp when webhook was created (milliseconds since epoch) */
  webhookTimestamp: number;
  /** Unique identifier for this webhook delivery */
  webhookId: string;
}

/**
 * Generic webhook payload from Linear
 */
export interface WebhookPayload extends WebhookPayloadBase {
  /** Action that triggered the webhook */
  action: "create" | "update" | "remove";
}

/**
 * Agent session webhook payload
 * Received when an agent is delegated work or receives follow-up prompts
 *
 * Note: Linear sends "AgentSessionEvent" as the type, with session data
 * in the "agentSession" field (not "data").
 */
export interface AgentSessionPayload extends Omit<WebhookPayloadBase, "type"> {
  /** Action type: 'created' for new delegation, 'prompted' for follow-up */
  action: "created" | "prompted";
  /** Resource type is always 'AgentSessionEvent' */
  type: "AgentSessionEvent";
  /** Agent session data */
  agentSession: {
    /** Agent session ID */
    id: string;
    /** ID of the issue this session is for */
    issueId: string;
    /** Session status */
    status: "pending" | "active" | "completed";
    /** URL to the agent session in Linear */
    url: string;
    /** Creator information */
    creator?: {
      id: string;
    };
  };
}

/**
 * Types of activities an agent can emit
 */
export type AgentActivityType =
  | "thought"
  | "action"
  | "response"
  | "error"
  | "elicitation";

/**
 * Thought activity content - agent's reasoning process
 */
export interface ThoughtActivityContent {
  type: "thought";
  /** Reasoning or thinking message */
  body: string;
}

/**
 * Action activity content - when agent performs an action
 */
export interface ActionActivityContent {
  type: "action";
  /** What action is being taken (e.g., 'Reading', 'Creating') */
  action: string;
  /** What the action is targeting (e.g., 'linked GitHub repository') */
  parameter: string;
}

/**
 * Response activity content - agent's final response
 */
export interface ResponseActivityContent {
  type: "response";
  /** Final response message */
  body: string;
}

/**
 * Error activity content - when agent encounters an error
 */
export interface ErrorActivityContent {
  type: "error";
  /** Error message */
  body: string;
}

/**
 * Elicitation activity content - when agent requests input from user
 */
export interface ElicitationActivityContent {
  type: "elicitation";
  /** Question or prompt for the user */
  body: string;
}

/**
 * Union type for all agent activity content types
 */
export type AgentActivityContent =
  | ThoughtActivityContent
  | ActionActivityContent
  | ResponseActivityContent
  | ErrorActivityContent
  | ElicitationActivityContent;

// IssueStatus is re-exported from @aesir/common (see linear/index.ts)

/**
 * Plan item for multi-step task progress
 */
export interface AgentPlanItem {
  /** Description of the step */
  content: string;
  /** Current status of the step */
  status: "pending" | "inProgress" | "completed";
}
