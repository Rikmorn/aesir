/**
 * Context Enrichment Helper
 *
 * Extracted from routeEvent() case "start" for DRY reuse.
 * Both the existing fast-path start and task-routing start path
 * call this helper to enrich initial messages with workspace
 * and event-specific context blocks.
 */

import type { IncomingEvent } from "../adapters/types.js";

/**
 * Deps subset needed for enrichment (workspace config).
 * Uses Pick-style interface to avoid importing full RouteEventDeps.
 */
export interface EnrichmentDeps {
  githubOwner?: string | undefined;
  githubRepo?: string | undefined;
  githubBaseBranch?: string | undefined;
  linearTeamId?: string | undefined;
  slackTeamId?: string | undefined;
  notifyChannels?: Record<string, string> | undefined;
}

/**
 * Enrich an initial message with workspace context and default notify target.
 *
 * Prepends:
 * 1. <workspace_context> block with GitHub owner/repo/branch, Linear team ID
 * 2. <default_notify_target> block with Slack ReplyContext JSON for proactive notifications
 *
 * The <slack_context> block was removed in Phase 65 -- replaced by <reply_context>
 * (injected via signals in Phase 61) and <default_notify_target> for proactive use.
 *
 * @param event - The incoming event
 * @param deps - Workspace configuration including notify channel map
 * @param message - Base message to enrich (defaults to event.message or JSON.stringify(event.data))
 * @param agentDefinitionId - Agent being started (used to resolve per-agent notify channel)
 * @returns Enriched message string
 */
export function enrichInitialMessage(
  event: IncomingEvent,
  deps: EnrichmentDeps,
  message?: string,
  agentDefinitionId?: string,
): string {
  let initialMessage = message ?? event.message ?? JSON.stringify(event.data);

  // Workspace context: GitHub owner/repo, Linear team ID, base branch.
  // Agents need these values for tool calls (github_create_branch, etc.)
  const workspaceLines: string[] = [];
  if (deps.githubOwner)
    workspaceLines.push(`GitHub Owner: ${deps.githubOwner}`);
  if (deps.githubRepo) workspaceLines.push(`GitHub Repo: ${deps.githubRepo}`);
  if (deps.githubBaseBranch)
    workspaceLines.push(`GitHub Base Branch: ${deps.githubBaseBranch}`);
  if (deps.linearTeamId)
    workspaceLines.push(`Linear Team ID: ${deps.linearTeamId}`);

  if (workspaceLines.length > 0) {
    const workspaceBlock = [
      "<workspace_context>",
      ...workspaceLines,
      "</workspace_context>",
    ].join("\n");
    initialMessage = `${workspaceBlock}\n\n${initialMessage}`;
  }

  // Default notify target: Slack channel address for proactive notifications (notify() tool).
  // Requires both slackTeamId and a matching notify channel for the agent.
  const notifyChannelId =
    agentDefinitionId && deps.notifyChannels?.[agentDefinitionId];
  if (deps.slackTeamId && notifyChannelId) {
    const target = JSON.stringify({
      channel: "slack",
      teamId: deps.slackTeamId,
      channelId: notifyChannelId,
    });
    const notifyBlock = [
      "<default_notify_target>",
      target,
      "</default_notify_target>",
    ].join("\n");
    initialMessage = `${notifyBlock}\n\n${initialMessage}`;
  }

  return initialMessage;
}
