/**
 * GitHub Event Normalization
 *
 * Converts GitHub webhook payloads to NormalizedEvent format.
 */

import { createId, type NormalizedEvent } from "@aesir/types";
import type { PRClosedPayload, PRReviewPayload } from "../webhooks/parser.js";

/**
 * Normalize PR review webhook payload to NormalizedEvent
 *
 * Event type includes the review state for fine-grained routing:
 * - github.pull_request.review_approved
 * - github.pull_request.review_changes_requested
 * - github.pull_request.review_commented
 * - github.pull_request.review_dismissed
 *
 * @param payload - Validated PR review webhook payload
 * @param deliveryId - X-GitHub-Delivery header value (used as correlationId)
 * @returns Normalized event ready for dispatch
 */
export function normalizePRReviewEvent(
  payload: PRReviewPayload,
  deliveryId: string,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: `github.pull_request.review_${payload.review.state}`,
    source: "github",
    timestamp: new Date(payload.review.submitted_at).toISOString(),
    correlationId: deliveryId,
    payload: {
      action: payload.action,
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prUrl: payload.pull_request.html_url,
      reviewId: payload.review.id,
      reviewState: payload.review.state,
      reviewBody: payload.review.body,
      reviewerLogin: payload.review.user.login,
      repository: {
        owner: payload.repository.owner.login,
        name: payload.repository.name,
        fullName: payload.repository.full_name,
      },
    },
  };
}

/**
 * Normalize PR merged event (from pull_request webhook with action=closed and merged=true)
 *
 * Note: This is for future use - current webhook handler only processes PR reviews.
 * Add when PR merged handling is needed.
 */
export function normalizePRMergedEvent(
  prNumber: number,
  prTitle: string,
  prUrl: string,
  repository: { owner: string; name: string; fullName: string },
  deliveryId: string,
): NormalizedEvent {
  return {
    id: createId.event(),
    type: "github.pull_request.merged",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: deliveryId,
    payload: {
      prNumber,
      prTitle,
      prUrl,
      repository,
    },
  };
}

/**
 * Normalize PR closed event (handles both merged and closed-without-merge)
 *
 * Event types:
 * - github.pull_request.merged: PR was merged (action=closed, merged=true)
 * - github.pull_request.closed: PR was closed without merge (action=closed, merged=false)
 *
 * @param payload - Validated PR closed webhook payload
 * @param deliveryId - X-GitHub-Delivery header value (used as correlationId)
 * @returns Normalized event ready for dispatch
 */
export function normalizePRClosedEvent(
  payload: PRClosedPayload,
  deliveryId: string,
): NormalizedEvent {
  const isMerged = payload.pull_request.merged === true;

  return {
    id: createId.event(),
    type: isMerged
      ? "github.pull_request.merged"
      : "github.pull_request.closed",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: deliveryId,
    payload: {
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prUrl: payload.pull_request.html_url,
      merged: isMerged,
      mergedBy: isMerged ? payload.pull_request.merged_by?.login : null,
      branchName: payload.pull_request.head.ref,
      repository: {
        owner: payload.repository.owner.login,
        name: payload.repository.name,
        fullName: payload.repository.full_name,
      },
    },
  };
}
