/**
 * Fast-Path Router
 *
 * Deterministic rule table for unambiguous events that need zero-latency routing.
 * Events matching a rule bypass the LLM slow path entirely.
 *
 * Covers 7 actionable event types (signal or start workflows) plus 2 ignore rules:
 *
 * Signal rules:
 * 1. slack-approval-button -> planApproval signal (approved: true)
 * 2. slack-rejection-button -> planApproval signal (approved: false)
 * 3. slack-escalation-retry -> escalationResolved signal (action: retry)
 * 4. slack-escalation-abort -> escalationResolved signal (action: abort)
 * 5. github-pr-merged -> prCompletion signal (merged: true)
 * 6. github-pr-closed -> prCompletion signal (merged: false)
 *
 * Start rules:
 * 7. linear-agent-session-created -> start orchestratorWorkflow
 *
 * Ignore rules:
 * 8. linear-issue-created -> ignore (handled by Linear webhooks directly)
 * 9. linear-issue-updated -> ignore (handled by Linear webhooks directly)
 */

import type { NormalizedEvent } from "@aesir/types";
import { callMcpTool } from "../shared/mcp/index.js";
import {
  escalationResolvedSignal,
  planApprovalSignal,
  prCompletionSignal,
} from "../shared/temporal/signals.js";
import type {
  FastPathAction,
  RouteResult,
  RouterDeps,
  RoutingRule,
} from "./types.js";

// ---------------------------------------------------------------------------
// Branch name regex for extracting task ID from PR branches
// ---------------------------------------------------------------------------

/**
 * Extracts task identifier from branch names.
 * Expected format: feature/{IDENTIFIER} (e.g., feature/ABC-123)
 */
const BRANCH_TASK_REGEX = /feature\/([A-Z]+-\d+)/i;

// ---------------------------------------------------------------------------
// Deterministic Rule Table
// ---------------------------------------------------------------------------

/**
 * All deterministic routing rules.
 *
 * Evaluated in order by matchFastPath(). First match wins.
 * Rules are grouped by source for readability.
 */
export const DETERMINISTIC_RULES: RoutingRule[] = [
  // === Slack Approval/Rejection Buttons ===

  {
    name: "slack-approval-button",
    match: (event) =>
      event.source === "slack" && event.type === "slack.block_actions.approved",
    action: (event) => {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "signal",
        workflowId: `dev-agent-${payload.taskIdentifier}`,
        signal: planApprovalSignal.name,
        payload: { approved: true, source: "slack" },
      };
    },
  },

  {
    name: "slack-rejection-button",
    match: (event) =>
      event.source === "slack" && event.type === "slack.block_actions.rejected",
    action: (event) => {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "signal",
        workflowId: `dev-agent-${payload.taskIdentifier}`,
        signal: planApprovalSignal.name,
        payload: {
          approved: false,
          feedback: "Rejected via Slack button",
          source: "slack",
        },
      };
    },
  },

  // === Slack Escalation Buttons ===

  {
    name: "slack-escalation-retry",
    match: (event) =>
      event.source === "slack" &&
      event.type === "slack.block_actions.escalation_retry",
    action: (event) => {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "signal",
        workflowId: `dev-agent-${payload.taskIdentifier}`,
        signal: escalationResolvedSignal.name,
        payload: { action: "retry" },
      };
    },
  },

  {
    name: "slack-escalation-abort",
    match: (event) =>
      event.source === "slack" &&
      event.type === "slack.block_actions.escalation_abort",
    action: (event) => {
      const payload = event.payload as { taskIdentifier: string };
      return {
        type: "signal",
        workflowId: `dev-agent-${payload.taskIdentifier}`,
        signal: escalationResolvedSignal.name,
        payload: { action: "abort" },
      };
    },
  },

  // === GitHub PR Events ===

  {
    name: "github-pr-merged",
    match: (event) =>
      event.source === "github" && event.type === "github.pull_request.merged",
    action: (event) => {
      const payload = event.payload as {
        branchName: string;
        prNumber: number;
      };
      const branchMatch = payload.branchName.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) {
        return {
          type: "ignore",
          reason: `Cannot extract task ID from branch: ${payload.branchName}`,
        };
      }
      return {
        type: "signal",
        workflowId: `dev-agent-${branchMatch[1]}`,
        signal: prCompletionSignal.name,
        payload: { merged: true, prNumber: payload.prNumber },
      };
    },
  },

  {
    name: "github-pr-closed",
    match: (event) =>
      event.source === "github" && event.type === "github.pull_request.closed",
    action: (event) => {
      const payload = event.payload as {
        branchName: string;
        prNumber: number;
      };
      const branchMatch = payload.branchName.match(BRANCH_TASK_REGEX);
      if (!branchMatch?.[1]) {
        return {
          type: "ignore",
          reason: `Cannot extract task ID from branch: ${payload.branchName}`,
        };
      }
      return {
        type: "signal",
        workflowId: `dev-agent-${branchMatch[1]}`,
        signal: prCompletionSignal.name,
        payload: { merged: false, prNumber: payload.prNumber },
      };
    },
  },

  // === Linear Agent Session ===

  {
    name: "linear-agent-session-created",
    match: (event) =>
      event.source === "linear" &&
      event.type === "linear.agent_session.created",
    action: (event) => {
      const payload = event.payload as { issueId: string };
      return {
        type: "start",
        workflowName: "orchestratorWorkflow",
        taskQueue: "dev-agent-v2",
        workflowId: `dev-agent-${payload.issueId}`,
        args: [],
        needsEnrichment: true,
        enrichmentContext: { issueId: payload.issueId },
      };
    },
  },

  // === Linear Ignore Rules ===

  {
    name: "linear-issue-created",
    match: (event) =>
      event.source === "linear" && event.type === "linear.issue.created",
    action: () => ({
      type: "ignore",
      reason:
        "Issue creation events are handled by Linear webhooks directly, not routed to agents",
    }),
  },

  {
    name: "linear-issue-updated",
    match: (event) =>
      event.source === "linear" && event.type === "linear.issue.updated",
    action: () => ({
      type: "ignore",
      reason:
        "Issue update events are handled by Linear webhooks directly, not routed to agents",
    }),
  },
];

// ---------------------------------------------------------------------------
// Match Function
// ---------------------------------------------------------------------------

/**
 * Attempt to match an event against the deterministic rule table.
 *
 * Returns the FastPathAction for the first matching rule, or null
 * if no rule matches (event should fall through to slow path).
 *
 * @param event - Normalized event to route
 * @returns FastPathAction if matched, null if no rule applies
 */
export function matchFastPath(event: NormalizedEvent): FastPathAction | null {
  for (const rule of DETERMINISTIC_RULES) {
    if (rule.match(event)) {
      return rule.action(event);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Issue details shape from MCP get_issue tool
// ---------------------------------------------------------------------------

interface IssueDetails {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
}

// ---------------------------------------------------------------------------
// Execute Function
// ---------------------------------------------------------------------------

/**
 * Execute a fast-path action.
 *
 * Handles all three action types:
 * - "signal": Send a Temporal signal to an existing workflow
 * - "start": Start a new Temporal workflow (with optional MCP enrichment)
 * - "ignore": Return ignored status with reason
 *
 * For "start" actions with needsEnrichment, fetches issue details via MCP
 * before starting the workflow (mirrors handleAgentSessionCreated behavior).
 *
 * @param action - The fast-path action to execute
 * @param deps - Router dependencies (Temporal client, logger)
 * @returns RouteResult indicating outcome
 */
export async function executeFastPath(
  action: FastPathAction,
  deps: RouterDeps,
): Promise<RouteResult> {
  const { workflowClient, logger } = deps;

  switch (action.type) {
    case "ignore": {
      logger.debug({ reason: action.reason }, "Fast-path: ignoring event");
      return { status: "ignored", action: `ignore:${action.reason}` };
    }

    case "signal": {
      const signalLogger = logger.child({
        action: "fast-path:signal",
        workflowId: action.workflowId,
        signal: action.signal,
      });

      try {
        const handle = workflowClient.workflow.getHandle(action.workflowId);
        await handle.signal(action.signal, action.payload);

        signalLogger.info("Fast-path: signal sent");
        return {
          status: "routed",
          action: `signal:${action.signal}`,
          workflowId: action.workflowId,
        };
      } catch (error) {
        const isNotFound =
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("WorkflowNotFoundError") ||
            error.name === "WorkflowNotFoundError");

        if (isNotFound) {
          signalLogger.warn("Fast-path: workflow not found for signal");
          return {
            status: "failed",
            action: `signal:${action.signal}`,
            workflowId: action.workflowId,
            error: "Workflow not found",
          };
        }

        signalLogger.error({ err: error }, "Fast-path: failed to send signal");
        return {
          status: "failed",
          action: `signal:${action.signal}`,
          workflowId: action.workflowId,
          error:
            error instanceof Error ? error.message : "Unknown signal error",
        };
      }
    }

    case "start": {
      const startLogger = logger.child({
        action: "fast-path:start",
        workflowName: action.workflowName,
        workflowId: action.workflowId,
        needsEnrichment: action.needsEnrichment,
      });

      try {
        let workflowArgs = action.args;

        // Enrich via MCP if needed (e.g., fetch full issue details for agent_session)
        if (action.needsEnrichment && action.enrichmentContext) {
          const issueId = action.enrichmentContext.issueId as
            | string
            | undefined;

          if (issueId) {
            startLogger.info({ issueId }, "Enriching with issue details");

            const issue = await callMcpTool<IssueDetails>({
              integration: "linear",
              tool: "get_issue",
              params: { issueId },
              agentId: "router",
              correlationId: action.workflowId,
            });

            const labelNames = issue.labels.map((l) => l.name);

            // Build OrchestratorWorkflowInput matching existing pattern
            workflowArgs = [
              {
                taskId: issue.id,
                issueIdentifier: issue.identifier,
                issue: {
                  id: issue.id,
                  identifier: issue.identifier,
                  title: issue.title,
                  description: issue.description,
                  priority: issue.priority,
                  labels: labelNames,
                },
                slackChannel: deps.alertsChannel || "",
              },
            ];
          }
        }

        await workflowClient.workflow.start(action.workflowName, {
          taskQueue: action.taskQueue,
          workflowId: action.workflowId,
          args: workflowArgs,
        });

        startLogger.info("Fast-path: workflow started");
        return {
          status: "routed",
          action: `start:${action.workflowName}`,
          workflowId: action.workflowId,
        };
      } catch (error) {
        const isAlreadyStarted =
          error instanceof Error &&
          (error.message.includes("already exists") ||
            error.message.includes("already started") ||
            error.name === "WorkflowExecutionAlreadyStartedError");

        if (isAlreadyStarted) {
          startLogger.info("Fast-path: workflow already exists (duplicate)");
          return {
            status: "routed",
            action: `start:${action.workflowName}(duplicate)`,
            workflowId: action.workflowId,
          };
        }

        startLogger.error(
          { err: error },
          "Fast-path: failed to start workflow",
        );
        return {
          status: "failed",
          action: `start:${action.workflowName}`,
          workflowId: action.workflowId,
          error: error instanceof Error ? error.message : "Unknown start error",
        };
      }
    }
  }
}
