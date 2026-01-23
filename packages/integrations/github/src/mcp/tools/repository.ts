/**
 * GitHub MCP Repository Tools
 *
 * Tool handlers for repository operations.
 */

import type { MCPToolContext, MCPToolResult } from "@aesir/common";
import { createErrorResult, createToolResult } from "@aesir/common";
import type { Octokit } from "@octokit/rest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GitHubCredentialStore } from "../../db/credential-store.js";
import { checkGitHubToolPermission } from "../../db/permissions.js";
import { createGitHubClientFromDatabase } from "../../oauth/flow.js";
import { GetRepositoryInputSchema, type RepositoryOutput } from "../schemas.js";

export interface RepositoryToolDeps {
  db: PostgresJsDatabase;
  credentialStore: GitHubCredentialStore;
  owner: string;
}

/**
 * Handle get_repository tool call
 */
export async function handleGetRepository(
  context: MCPToolContext,
  args: unknown,
  deps: RepositoryToolDeps,
): Promise<MCPToolResult<RepositoryOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "get_repository" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "get_repository" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: get_repository not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = GetRepositoryInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for get_repository",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  try {
    // Create GitHub client
    const octokit: Octokit = await createGitHubClientFromDatabase(
      credentialStore,
      owner,
    );

    // Get repository
    const { data: repo } = await octokit.rest.repos.get({
      owner: input.owner,
      repo: input.repo,
    });

    const output: RepositoryOutput = {
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      defaultBranch: repo.default_branch,
      url: repo.html_url,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo },
      "Repository fetched successfully",
    );

    return createToolResult(
      context,
      `Repository: ${repo.full_name}\nDefault branch: ${repo.default_branch}\nPrivate: ${repo.private}\nURL: ${repo.html_url}`,
      output,
    );
  } catch (error) {
    context.logger.error(
      { err: error, owner: input.owner, repo: input.repo },
      "Failed to get repository",
    );
    return createErrorResult(
      context,
      `Failed to get repository: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
