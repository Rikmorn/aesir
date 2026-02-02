/**
 * GitHub Adapter
 *
 * Transforms GitHub NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - pull_request.merged -> "pr_merged" (fast-path signal)
 * - pull_request.closed -> "pr_closed" (fast-path signal)
 *
 * Returns null for:
 * - pull_request.review_submitted -> slow-path LLM (PR reviews carry nuance)
 * - PR events with non-matching branch names (can't extract task ID)
 * - Any unrecognized GitHub event type
 */

import type { NormalizedEvent } from "@aesir/types";
import type { IncomingEvent } from "./types.js";

/**
 * Extracts task identifier from branch names.
 * Expected format: feature/{IDENTIFIER} (e.g., feature/ABC-123)
 */
const BRANCH_TASK_REGEX = /feature\/([A-Z]+-\d+)/i;

/**
 * Adapt a GitHub NormalizedEvent into a domain-language IncomingEvent.
 * Returns null if the event type is not recognized or if the branch name
 * does not match the expected pattern for task ID extraction.
 */
export function adaptGitHubEvent(event: NormalizedEvent): IncomingEvent | null {
  if (event.source !== "github") return null;

  const payload = event.payload as Record<string, unknown>;

  switch (event.type) {
    case "github.pull_request.merged": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName?.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null; // Can't extract task ID -> fall through
      return {
        type: "pr_merged",
        data: { merged: true, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was merged into main.`,
      };
    }

    case "github.pull_request.closed": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName?.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null; // Can't extract task ID -> fall through
      return {
        type: "pr_closed",
        data: { merged: false, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was closed without merging.`,
      };
    }

    // github.pull_request.review_submitted -> return null for slow-path
    default:
      return null;
  }
}
