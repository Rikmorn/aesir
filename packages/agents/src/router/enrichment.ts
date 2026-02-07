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
}

/**
 * Enrich an initial message with workspace context and event-specific context blocks.
 *
 * Prepends:
 * 1. <workspace_context> block with GitHub owner/repo/branch, Linear team ID
 * 2. <slack_context> block with channel/thread for Slack-originated events
 *
 * @param event - The incoming event (used for Slack context detection)
 * @param deps - Workspace configuration
 * @param message - Base message to enrich (defaults to event.message or JSON.stringify(event.data))
 * @returns Enriched message string
 */
export function enrichInitialMessage(
  event: IncomingEvent,
  deps: EnrichmentDeps,
  message?: string,
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

  // Slack-specific context for Slack-originated events.
  // Product agent prompt expects <slack_context> with channel, thread, team.
  const eventData = event.data as Record<string, unknown>;
  if (event.source === "slack:webhook" && eventData?.channelId) {
    const contextBlock = [
      "<slack_context>",
      `Channel: ${eventData.channelId}`,
      `Thread: ${eventData.threadTs ?? ""}`,
      "</slack_context>",
    ].join("\n");
    initialMessage = `${contextBlock}\n\n${initialMessage}`;
  }

  return initialMessage;
}
