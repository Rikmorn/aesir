/**
 * Linear MCP Tools - Teams & Labels
 *
 * Provides MCP tools for team and label operations:
 * - list_teams: List all teams
 * - list_labels: List labels (optionally filtered by team)
 */

import type { MCPLogger, MCPToolContext, MCPToolResult } from "@aesir/common";
import { createErrorResult, createToolResult } from "@aesir/common";
import type { LinearClient } from "@linear/sdk";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { checkLinearToolPermission } from "../../db/permissions.js";
import { createLinearClientFromDatabase } from "../../oauth/flow.js";
import {
  ListLabelsInputSchema,
  type ListLabelsOutput,
  ListTeamsInputSchema,
  type ListTeamsOutput,
} from "../schemas.js";

export interface TeamToolDeps {
  db: PostgresJsDatabase;
  logger: MCPLogger;
  workspaceId: string;
}

/**
 * Handle list_teams tool call
 */
export async function handleListTeams(
  context: MCPToolContext,
  args: unknown,
  deps: TeamToolDeps,
): Promise<MCPToolResult<ListTeamsOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "list_teams" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "list_teams" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: list_teams not allowed for this agent",
    );
  }

  // Validate input (no required inputs for list_teams)
  const parseResult = ListTeamsInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for list_teams",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Get teams
    const teams = await client.teams();

    const teamList = teams.nodes.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    }));

    const output: ListTeamsOutput = {
      teams: teamList,
      count: teamList.length,
    };

    context.logger.info(
      { count: teamList.length },
      "Teams listed successfully",
    );

    return createToolResult(
      context,
      `Found ${teamList.length} teams:\n${teamList.map((t) => `- ${t.name} (${t.key})`).join("\n")}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error }, "Failed to list teams");
    return createErrorResult(
      context,
      `Failed to list teams: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle list_labels tool call
 */
export async function handleListLabels(
  context: MCPToolContext,
  args: unknown,
  deps: TeamToolDeps,
): Promise<MCPToolResult<ListLabelsOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "list_labels" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "list_labels" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: list_labels not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = ListLabelsInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for list_labels",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const { teamId } = parseResult.data;

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Get team-specific labels
    const team = await client.team(teamId);
    if (!team) {
      context.logger.warn({ teamId }, "Team not found");
      return createErrorResult(context, `Team not found: ${teamId}`);
    }

    const labels = await team.labels();

    const labelList = labels.nodes.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    }));

    const output: ListLabelsOutput = {
      labels: labelList,
      count: labelList.length,
      teamId,
    };

    context.logger.info(
      { teamId, count: labelList.length },
      "Labels listed successfully",
    );

    return createToolResult(
      context,
      `Found ${labelList.length} labels for team ${team.name}:\n${labelList.map((l) => `- ${l.name}`).join("\n")}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, teamId }, "Failed to list labels");
    return createErrorResult(
      context,
      `Failed to list labels: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
