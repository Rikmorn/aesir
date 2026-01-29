/**
 * Complete Node
 *
 * Finalizes workflow after PR merge. Updates Linear status to "Done",
 * sends completion notification to main Slack channel with summary stats,
 * and cleans up the dev container.
 *
 * Non-critical operations fail gracefully to ensure workflow completion.
 */

import type { DevContainerCleanup } from "@aesir/platform";
import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { callMcpTool } from "../../../shared/mcp/index.js";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:complete",
});

/**
 * Completion statistics for summary
 */
interface CompletionStats {
  /** Number of files changed */
  filesChanged: number;
  /** Approximate lines added (based on file content) */
  linesAdded: number;
  /** Lines removed (not tracked, always 0) */
  linesRemoved: number;
  /** Number of execution steps in plan */
  executionSteps: number;
}

/**
 * Build completion statistics from state
 */
function buildCompletionStats(state: DevAgentState): CompletionStats {
  const filesChanged = state.files.length;
  const linesAdded = state.files.reduce(
    (sum, f) => sum + f.content.split("\n").length,
    0,
  );

  return {
    filesChanged,
    linesAdded,
    linesRemoved: 0, // Would need git diff for accurate count
    executionSteps: state.executionPlan?.steps.length ?? 0,
  };
}

/**
 * Format completion message for Slack notification fallback text
 */
function formatCompletionMessage(
  state: DevAgentState,
  stats: CompletionStats,
): string {
  const identifier = state.issue?.identifier ?? "Unknown";
  const title = state.issue?.title ?? "Unknown task";
  const prUrl = state.prUrl ?? "N/A";

  return (
    `:white_check_mark: *${identifier} completed!*\n\n` +
    `*${title}*\n\n` +
    `PR: ${prUrl}\n` +
    `Files: ${stats.filesChanged} | Steps: ${stats.executionSteps}`
  );
}

/**
 * Build Block Kit blocks for rich completion notification
 */
function buildCompletionBlocks(
  state: DevAgentState,
  stats: CompletionStats,
): object[] {
  const identifier = state.issue?.identifier ?? "Unknown";
  const title = state.issue?.title ?? "Unknown task";
  const prUrl = state.prUrl;
  const prNumber = state.prNumber;

  const prDisplay =
    prUrl && prNumber ? `<${prUrl}|#${prNumber}>` : (prUrl ?? "N/A");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *${identifier} completed!*`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${title}` },
        { type: "mrkdwn", text: `*PR:*\n${prDisplay}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${stats.filesChanged} files | ${stats.executionSteps} steps`,
        },
      ],
    },
  ];
}

/**
 * Dependencies for complete node
 */
export interface CompleteNodeDeps {
  /** Cleanup service for container removal */
  cleanup: DevContainerCleanup;
  /** Slack channel for completion notifications */
  slackChannel: string;
}

/**
 * Create complete node for workflow finalization.
 *
 * Updates Linear status to Done, sends Slack notification with stats,
 * and cleans up the dev container. Non-critical operations fail gracefully.
 *
 * @param deps - Dependencies including cleanup service and Slack channel
 * @returns Node function for LangGraph
 */
export function createCompleteNode(deps: CompleteNodeDeps) {
  return async function completeNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, containerId } = state;
    const nodeLogger = logger.child({ taskId });

    nodeLogger.info("Completing workflow");

    // Build completion stats
    const stats = buildCompletionStats(state);

    const correlationId = `complete-${taskId}`;

    // Update Linear status to "Done" (non-critical)
    if (issue) {
      try {
        await callMcpTool({
          integration: "linear",
          tool: "update_issue_status",
          params: {
            issueId: issue.id,
            statusName: "Done",
          },
          agentId: "dev-agent",
          correlationId,
        });
        nodeLogger.info({ issueId: issue.id }, "Linear status updated to Done");
      } catch (error) {
        // Non-critical - log but continue
        nodeLogger.warn({ err: error }, "Failed to update Linear status");
      }
    }

    // Send completion notification to main channel (non-critical)
    if (deps.slackChannel) {
      try {
        const completionMessage = formatCompletionMessage(state, stats);
        const completionBlocks = buildCompletionBlocks(state, stats);

        await callMcpTool({
          integration: "slack",
          tool: "send_message",
          params: {
            channel: deps.slackChannel,
            text: completionMessage,
            blocks: completionBlocks,
          },
          agentId: "dev-agent",
          correlationId,
        });
        nodeLogger.info("Completion notification sent to Slack");
      } catch (error) {
        nodeLogger.warn({ err: error }, "Failed to send Slack notification");
      }
    } else {
      nodeLogger.warn("No Slack channel configured, skipping notification");
    }

    // Cleanup container (non-critical - cleanup service will catch orphans)
    if (containerId) {
      try {
        await deps.cleanup.cleanupContainer(taskId);
        nodeLogger.info(
          { containerId: containerId.slice(0, 12) },
          "Container cleaned up",
        );
      } catch (error) {
        // Non-critical - cleanup service will catch orphans via scheduled job
        nodeLogger.warn({ err: error }, "Failed to cleanup container");
      }
    }

    nodeLogger.info(
      {
        filesChanged: stats.filesChanged,
        executionSteps: stats.executionSteps,
      },
      "Workflow completed successfully",
    );

    // Return final state - phase stays "complete"
    // (The phase was already set to "complete" by the Temporal signal handler)
    return {};
  };
}
