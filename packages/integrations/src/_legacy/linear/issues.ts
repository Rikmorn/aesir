/**
 * Linear Issue Management
 *
 * Functions for creating issues and listing teams/labels in Linear.
 * Used by the Product Agent to create tasks from gathered requirements.
 */

import { createPinoLogger } from "@aesir/common";
import type { IssueLabel, LinearClient, Team } from "@linear/sdk";

const logger = createPinoLogger({ component: "integrations:linear" });

/**
 * Parameters for creating a new issue
 */
export interface CreateIssueParams {
  /** Team ID to create the issue in (required) */
  teamId: string;
  /** Issue title (required) */
  title: string;
  /** Issue description in markdown (optional) */
  description?: string;
  /** Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low (optional) */
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Array of label UUIDs to apply (optional) */
  labelIds?: string[];
}

/**
 * Result of creating an issue
 */
export interface CreateIssueResult {
  /** Issue UUID */
  id: string;
  /** Issue identifier (e.g., "ABC-123") */
  identifier: string;
  /** URL to view the issue in Linear */
  url: string;
  /** Issue title */
  title: string;
}

/**
 * Team info for selection
 */
export interface TeamInfo {
  /** Team UUID */
  id: string;
  /** Team name */
  name: string;
  /** Team key (e.g., "ABC") */
  key: string;
}

/**
 * Label info for tagging
 */
export interface LabelInfo {
  /** Label UUID */
  id: string;
  /** Label name */
  name: string;
  /** Label color (hex) */
  color: string;
}

/**
 * Create a new issue in Linear
 *
 * @param client - LinearClient instance
 * @param params - Issue parameters
 * @returns Created issue with id, identifier, and url
 * @throws Error if issue creation fails
 */
export async function createIssue(
  client: LinearClient,
  params: CreateIssueParams,
): Promise<CreateIssueResult> {
  const { teamId, title, description, priority, labelIds } = params;

  logger.debug(
    {
      teamId,
      title,
      hasPriority: priority !== undefined,
      labelCount: labelIds?.length ?? 0,
    },
    `Creating issue: ${title}`,
  );

  // Build params object, only including defined values for exactOptionalPropertyTypes
  const createParams: {
    teamId: string;
    title: string;
    description?: string;
    priority?: 0 | 1 | 2 | 3 | 4;
    labelIds?: string[];
  } = { teamId, title };

  if (description !== undefined) {
    createParams.description = description;
  }
  if (priority !== undefined) {
    createParams.priority = priority;
  }
  if (labelIds !== undefined) {
    createParams.labelIds = labelIds;
  }

  const createResult = await client.createIssue(createParams);

  if (!createResult.success) {
    throw new Error(`Failed to create issue: ${title}`);
  }

  const issue = await createResult.issue;
  if (!issue) {
    throw new Error(`Issue created but could not retrieve: ${title}`);
  }

  logger.info(
    { issueId: issue.id, identifier: issue.identifier, url: issue.url },
    `Created issue ${issue.identifier}: ${title}`,
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    title: issue.title,
  };
}

/**
 * List available teams in the workspace
 *
 * @param client - LinearClient instance
 * @returns Array of teams with id, name, and key
 */
export async function listTeams(client: LinearClient): Promise<TeamInfo[]> {
  logger.debug("Listing available teams");

  const teams = await client.teams();

  const teamList = teams.nodes.map((team: Team) => ({
    id: team.id,
    name: team.name,
    key: team.key,
  }));

  logger.info({ count: teamList.length }, `Found ${teamList.length} teams`);

  return teamList;
}

/**
 * List labels for a specific team
 *
 * @param client - LinearClient instance
 * @param teamId - Team ID to list labels for
 * @returns Array of labels with id, name, and color
 */
export async function listLabels(
  client: LinearClient,
  teamId: string,
): Promise<LabelInfo[]> {
  logger.debug({ teamId }, `Listing labels for team ${teamId}`);

  // Get team-specific labels
  const team = await client.team(teamId);
  if (!team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  const labels = await team.labels();

  const labelList = labels.nodes.map((label: IssueLabel) => ({
    id: label.id,
    name: label.name,
    color: label.color,
  }));

  logger.info(
    { teamId, count: labelList.length },
    `Found ${labelList.length} labels for team`,
  );

  return labelList;
}
