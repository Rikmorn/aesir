/**
 * GitHub Webhook Type Definitions
 *
 * Types for GitHub webhook headers, events, and payloads.
 */

/**
 * GitHub webhook headers
 *
 * These headers are present on all GitHub webhook requests.
 */
export interface GitHubWebhookHeaders {
  /** HMAC signature with sha256= prefix */
  "x-hub-signature-256": string;
  /** Unique delivery ID for idempotency tracking */
  "x-github-delivery": string;
  /** Event type (e.g., "pull_request_review", "push") */
  "x-github-event": string;
}

/**
 * GitHub webhook event types
 *
 * Currently focused on PR review workflow.
 * Expand as needed for other event types.
 */
export type GitHubWebhookEvent =
  | "pull_request_review"
  | "pull_request"
  | "push";

/**
 * Base structure shared by all GitHub webhook payloads
 */
export interface WebhookPayloadBase {
  /** Action that triggered the event (varies by event type) */
  action: string;
  /** User who triggered the event */
  sender?: {
    login: string;
    id: number;
  };
  /** Repository where the event occurred */
  repository?: {
    name: string;
    owner: {
      login: string;
    };
  };
}
