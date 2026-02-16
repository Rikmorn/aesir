/**
 * GitHub Adapter
 *
 * Transforms GitHub NormalizedEvents into domain-language IncomingEvents.
 *
 * Handles:
 * - pull_request.merged -> "pr_merged" (fast-path signal)
 * - pull_request.closed -> "pr_closed" (fast-path signal)
 * - pull_request.review_submitted -> "pr_review" (domain-language)
 * - pull_request.review_approved -> "pr_review" (domain-language)
 * - pull_request.review_changes_requested -> "pr_review" (domain-language)
 * - pull_request.review_commented -> "pr_review" (domain-language)
 * - pull_request.review_dismissed -> "pr_review" (domain-language)
 *
 * Returns null for:
 * - PR events with non-matching branch names (can't extract task ID)
 * - Any unrecognized GitHub event type
 */

import type { NormalizedEvent } from "@aesir/types";
import { config } from "../shared/env/config.js";
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
  const taskId = payload.taskId as string | undefined;

  // Extract actor info for echo suppression (Phase 75)
  // GitHub uses sender.login compared to the configured GITHUB_APP_LOGIN
  const sender = payload.sender as { login: string; type?: string } | undefined;
  const githubAppLogin = config.echo.githubAppLogin;
  const actorInfo =
    sender && githubAppLogin
      ? { isBot: sender.login === githubAppLogin, identifier: sender.login }
      : undefined;

  switch (event.type) {
    case "github.pull_request.merged": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName?.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null; // Can't extract task ID -> fall through
      const repository = payload.repository as
        | { owner: string; name: string }
        | undefined;
      return {
        type: "pr_merged",
        data: { merged: true, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was merged into main.`,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        ...(repository?.owner &&
          repository?.name &&
          prNumber && {
            replyContext: {
              channel: "github" as const,
              owner: repository.owner,
              repo: repository.name,
              prNumber,
            },
          }),
      };
    }

    case "github.pull_request.closed": {
      const branchName = payload.branchName as string;
      const prNumber = payload.prNumber as number;
      const branchMatch = branchName?.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) return null; // Can't extract task ID -> fall through
      const repository = payload.repository as
        | { owner: string; name: string }
        | undefined;
      return {
        type: "pr_closed",
        data: { merged: false, prNumber },
        source: "github:webhook",
        correlationKey: branchMatch[1],
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} (${branchName}) was closed without merging.`,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        ...(repository?.owner &&
          repository?.name &&
          prNumber && {
            replyContext: {
              channel: "github" as const,
              owner: repository.owner,
              repo: repository.name,
              prNumber,
            },
          }),
      };
    }

    case "github.pull_request.review_submitted":
    case "github.pull_request.review_approved":
    case "github.pull_request.review_changes_requested":
    case "github.pull_request.review_commented":
    case "github.pull_request.review_dismissed": {
      const prNumber = payload.prNumber as number;
      const repository = payload.repository as
        | { owner: string; name: string }
        | undefined;
      return {
        type: "pr_review",
        data: {
          reviewState: payload.reviewState,
          reviewBody: payload.reviewBody,
          reviewerLogin: payload.reviewerLogin,
          prNumber,
        },
        source: "github:webhook",
        // No correlationKey -- PR reviews don't include branchName, always goes to slow_path
        deduplicationId: event.correlationId,
        message: `PR #${prNumber} review (${payload.reviewState}): ${(payload.reviewBody as string) || "(no comment)"}`,
        ...(taskId !== undefined && { taskId }),
        ...(actorInfo && { actorInfo }),
        ...(repository?.owner &&
          repository?.name &&
          prNumber && {
            replyContext: {
              channel: "github" as const,
              owner: repository.owner,
              repo: repository.name,
              prNumber,
            },
          }),
      };
    }

    default:
      return null;
  }
}
