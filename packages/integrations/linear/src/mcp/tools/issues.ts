/**
 * Linear MCP Tools - Issues
 *
 * Provides MCP tools for Linear issue operations:
 * - get_issue: Retrieve issue details
 * - create_issue: Create new issue
 * - update_issue_status: Change issue workflow state
 */

import type { MCPToolContext, MCPToolResult, PinoLogger } from "@aesir/common";
import { createErrorResult, createToolResult } from "@aesir/common";
import type { Issue, LinearClient } from "@linear/sdk";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { checkLinearToolPermission } from "../../db/permissions.js";
import { createLinearClientFromDatabase } from "../../oauth/flow.js";
import {
  CreateCommentInputSchema,
  type CreateCommentOutput,
  CreateIssueInputSchema,
  type CreateIssueOutput,
  GetIssueInputSchema,
  type IssueOutput,
  UpdateIssueStatusInputSchema,
  type UpdateIssueStatusOutput,
} from "../schemas.js";

export interface IssueToolDeps {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  workspaceId: string;
}

/**
 * Handle get_issue tool call
 */
export async function handleGetIssue(
  context: MCPToolContext,
  args: unknown,
  deps: IssueToolDeps,
): Promise<MCPToolResult<IssueOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "get_issue" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "get_issue" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: get_issue not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = GetIssueInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for get_issue",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const { issueId } = parseResult.data;

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Get issue
    const issue: Issue = await client.issue(issueId);

    if (!issue) {
      context.logger.warn({ issueId }, "Issue not found");
      return createErrorResult(context, `Issue not found: ${issueId}`);
    }

    // Fetch related data
    const state = await issue.state;
    const team = await issue.team;
    const labels = await issue.labels();

    const output: IssueOutput = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || null,
      url: issue.url,
      state: {
        id: state?.id || "unknown",
        name: state?.name || "Unknown",
        type: state?.type || "unknown",
      },
      team: {
        id: team?.id || "unknown",
        name: team?.name || "Unknown",
        key: team?.key || "UNK",
      },
      priority: issue.priority || null,
      labels: labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
    };

    context.logger.info(
      { issueId: issue.id, identifier: issue.identifier },
      "Issue fetched successfully",
    );

    return createToolResult(
      context,
      `Issue ${issue.identifier}: ${issue.title}\nState: ${state?.name || "Unknown"}\nTeam: ${team?.name || "Unknown"}\nURL: ${issue.url}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, issueId }, "Failed to fetch issue");
    return createErrorResult(
      context,
      `Failed to fetch issue: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle create_issue tool call
 */
export async function handleCreateIssue(
  context: MCPToolContext,
  args: unknown,
  deps: IssueToolDeps,
): Promise<MCPToolResult<CreateIssueOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_issue" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_issue" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_issue not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreateIssueInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_issue",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Build create params with conditional properties for exactOptionalPropertyTypes
    const createParams: {
      teamId: string;
      title: string;
      description?: string;
      priority?: 0 | 1 | 2 | 3 | 4;
      labelIds?: string[];
    } = {
      teamId: input.teamId,
      title: input.title,
    };

    if (input.description !== undefined) {
      createParams.description = input.description;
    }
    if (input.priority !== undefined) {
      createParams.priority = input.priority;
    }
    if (input.labelIds !== undefined) {
      createParams.labelIds = input.labelIds;
    }

    // Create issue
    const createResult = await client.createIssue(createParams);

    if (!createResult.success) {
      context.logger.error({ input }, "Failed to create issue");
      return createErrorResult(context, "Failed to create issue");
    }

    const issue = await createResult.issue;

    if (!issue) {
      context.logger.error({ input }, "Issue created but could not retrieve");
      return createErrorResult(context, "Issue created but could not retrieve");
    }

    const output: CreateIssueOutput = {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      title: issue.title,
    };

    context.logger.info(
      { issueId: issue.id, identifier: issue.identifier },
      "Issue created successfully",
    );

    return createToolResult(
      context,
      `Created issue ${issue.identifier}: ${issue.title}\nURL: ${issue.url}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to create issue");
    return createErrorResult(
      context,
      `Failed to create issue: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle update_issue_status tool call
 */
export async function handleUpdateIssueStatus(
  context: MCPToolContext,
  args: unknown,
  deps: IssueToolDeps,
): Promise<MCPToolResult<UpdateIssueStatusOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "update_issue_status" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "update_issue_status" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: update_issue_status not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = UpdateIssueStatusInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for update_issue_status",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const { issueId, statusName } = parseResult.data;

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Get the issue to find its team
    const issue = await client.issue(issueId);
    if (!issue) {
      context.logger.warn({ issueId }, "Issue not found");
      return createErrorResult(context, `Issue not found: ${issueId}`);
    }

    // Get the team's workflow states
    const team = await issue.team;
    if (!team) {
      context.logger.error({ issueId }, "Team not found for issue");
      return createErrorResult(context, `Team not found for issue: ${issueId}`);
    }

    const states = await team.states();
    const targetState = states.nodes.find((state) => state.name === statusName);

    if (!targetState) {
      const availableStates = states.nodes.map((s) => s.name);
      context.logger.warn(
        { issueId, statusName, availableStates },
        "State not found for team",
      );
      return createErrorResult(
        context,
        `State "${statusName}" not found for team. Available states: ${availableStates.join(", ")}`,
      );
    }

    // Update the issue
    await client.updateIssue(issueId, {
      stateId: targetState.id,
    });

    const output: UpdateIssueStatusOutput = {
      issueId: issue.id,
      statusName: targetState.name,
      success: true,
    };

    context.logger.info(
      { issueId: issue.id, statusName: targetState.name },
      "Issue status updated successfully",
    );

    return createToolResult(
      context,
      `Updated issue ${issue.identifier} to status: ${targetState.name}`,
      output,
    );
  } catch (error) {
    context.logger.error(
      { err: error, issueId, statusName },
      "Failed to update issue status",
    );
    return createErrorResult(
      context,
      `Failed to update issue status: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle create_comment tool call
 */
export async function handleCreateComment(
  context: MCPToolContext,
  args: unknown,
  deps: IssueToolDeps,
): Promise<MCPToolResult<CreateCommentOutput>> {
  const { db, logger: _logger, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_comment" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_comment" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_comment not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreateCommentInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_comment",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const { issueId, body } = parseResult.data;

  try {
    // Create Linear client
    const client: LinearClient =
      await createLinearClientFromDatabase(workspaceId);

    // Create comment
    const createResult = await client.createComment({
      issueId,
      body,
    });

    if (!createResult.success) {
      context.logger.error({ issueId }, "Failed to create comment");
      return createErrorResult(context, "Failed to create comment");
    }

    const comment = await createResult.comment;

    if (!comment) {
      context.logger.error(
        { issueId },
        "Comment created but could not retrieve",
      );
      return createErrorResult(
        context,
        "Comment created but could not retrieve",
      );
    }

    const output: CreateCommentOutput = {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };

    context.logger.info(
      { commentId: comment.id, issueId },
      "Comment created successfully",
    );

    return createToolResult(
      context,
      `Created comment on issue ${issueId}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, issueId }, "Failed to create comment");
    return createErrorResult(
      context,
      `Failed to create comment: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
