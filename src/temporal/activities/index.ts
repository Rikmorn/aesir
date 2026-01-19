/**
 * Temporal Activities Index
 *
 * Re-exports all activities for worker registration.
 * Activities wrap existing integration code to make them
 * callable from Temporal workflows with retry and timeout support.
 *
 * The makeActivities factory binds client dependencies at worker startup,
 * allowing workflows to call activities without serializing clients.
 */

import type { WebClient } from "@slack/web-api";
import type { Octokit } from "@octokit/rest";
import type { LinearClient } from "@linear/sdk";
import type { Sandbox } from "../../sandbox/types.js";

// Import raw activities for binding
import { executeDevWorkflow } from "./dev-agent-activity.js";
import {
  mergePRActivity,
  type MergePRInput,
  type MergePROutput,
} from "./github-activities.js";
import {
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
} from "./slack-activities.js";
import { updateLinearStatusActivity } from "./linear-activities.js";

// Re-export types for external use
export type { MergePRInput, MergePROutput };

/**
 * Dependencies required by Temporal activities.
 * These are bound at worker startup time via makeActivities.
 */
export interface ActivityDependencies {
  /** Slack WebClient for notifications */
  slackClient: WebClient;
  /** GitHub Octokit client for PR operations */
  octokit: Octokit;
  /** Linear client for issue management */
  linearClient: LinearClient;
  /** Sandbox for code execution (dev workflow) */
  sandbox: Sandbox;
}

/**
 * Create bound activities with injected dependencies.
 *
 * This factory creates activity functions that have their client dependencies
 * already bound, so workflows can call them without passing client instances.
 *
 * Usage in worker:
 * ```typescript
 * const worker = await Worker.create({
 *   activities: makeActivities(dependencies),
 *   ...
 * });
 * ```
 *
 * @param deps - Client dependencies to bind to activities
 * @returns Object with bound activity functions
 */
export function makeActivities(deps: ActivityDependencies) {
  return {
    /**
     * Send approval request notification - bound with Slack client
     */
    sendApprovalRequestActivity: (
      notification: Parameters<typeof sendApprovalRequestActivity>[1],
      channel: Parameters<typeof sendApprovalRequestActivity>[2]
    ) => sendApprovalRequestActivity(deps.slackClient, notification, channel),

    /**
     * Send status update notification - bound with Slack client
     */
    sendStatusUpdateActivity: (
      notification: Parameters<typeof sendStatusUpdateActivity>[1],
      channel: Parameters<typeof sendStatusUpdateActivity>[2]
    ) => sendStatusUpdateActivity(deps.slackClient, notification, channel),

    /**
     * Merge pull request - bound with Octokit
     */
    mergePRActivity: (input: Parameters<typeof mergePRActivity>[1]) =>
      mergePRActivity(deps.octokit, input),

    /**
     * Update Linear issue status - bound with Linear client
     */
    updateLinearStatusActivity: (
      issueId: Parameters<typeof updateLinearStatusActivity>[1],
      statusName: Parameters<typeof updateLinearStatusActivity>[2]
    ) => updateLinearStatusActivity(deps.linearClient, issueId, statusName),

    /**
     * Execute dev workflow - bound with all required dependencies
     */
    executeDevWorkflow: (taskId: string) =>
      executeDevWorkflow(taskId, {
        linearClient: deps.linearClient,
        octokit: deps.octokit,
        sandbox: deps.sandbox,
        // githubConfig is required by DevWorkflowDependencies
        // but should be passed from environment at worker level
        githubConfig: {
          owner: process.env["GITHUB_OWNER"] ?? "",
          repo: process.env["GITHUB_REPO"]?.split("/")[1] ?? "",
          baseBranch: process.env["GITHUB_BASE_BRANCH"] ?? "main",
        },
      }),
  };
}

/**
 * Type for the bound activities returned by makeActivities.
 * Use this in workflows with proxyActivities<BoundActivities>().
 */
export type BoundActivities = ReturnType<typeof makeActivities>;

// Also export raw activities for backward compatibility and direct testing
export {
  executeDevWorkflow,
  mergePRActivity,
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
  updateLinearStatusActivity,
};
