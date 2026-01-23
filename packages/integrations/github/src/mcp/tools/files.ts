/**
 * GitHub MCP File Tools
 *
 * Tool handlers for file operations.
 */

import type { MCPToolContext, MCPToolResult } from "@aesir/common";
import { createErrorResult, createToolResult } from "@aesir/common";
import type { Octokit } from "@octokit/rest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GitHubCredentialStore } from "../../db/credential-store.js";
import { checkGitHubToolPermission } from "../../db/permissions.js";
import { createGitHubClientFromDatabase } from "../../oauth/flow.js";
import {
  type FileContentsOutput,
  GetFileContentsInputSchema,
  ListFilesInputSchema,
  type ListFilesOutput,
} from "../schemas.js";

export interface FileToolDeps {
  db: PostgresJsDatabase;
  credentialStore: GitHubCredentialStore;
  owner: string;
}

/**
 * Handle get_file_contents tool call
 */
export async function handleGetFileContents(
  context: MCPToolContext,
  args: unknown,
  deps: FileToolDeps,
): Promise<MCPToolResult<FileContentsOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "get_file_contents" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "get_file_contents" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: get_file_contents not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = GetFileContentsInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for get_file_contents",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  try {
    const octokit: Octokit = await createGitHubClientFromDatabase(
      credentialStore,
      owner,
    );

    // Get file contents
    const params: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    } = {
      owner: input.owner,
      repo: input.repo,
      path: input.path,
    };
    if (input.ref !== undefined) {
      params.ref = input.ref;
    }

    const { data } = await octokit.rest.repos.getContent(params);

    // Ensure we got a file, not a directory
    if (Array.isArray(data) || data.type !== "file") {
      return createErrorResult(context, "Path is not a file");
    }

    // Decode content from base64
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    const output: FileContentsOutput = {
      path: data.path,
      content,
      sha: data.sha,
      size: data.size,
      encoding: data.encoding,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, path: input.path },
      "File contents fetched successfully",
    );

    return createToolResult(
      context,
      `File: ${data.path}\nSize: ${data.size} bytes\nSHA: ${data.sha}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to get file contents");
    return createErrorResult(
      context,
      `Failed to get file contents: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle list_files tool call
 */
export async function handleListFiles(
  context: MCPToolContext,
  args: unknown,
  deps: FileToolDeps,
): Promise<MCPToolResult<ListFilesOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "list_files" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "list_files" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: list_files not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = ListFilesInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for list_files",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  try {
    const octokit: Octokit = await createGitHubClientFromDatabase(
      credentialStore,
      owner,
    );

    // List directory contents
    const params: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    } = {
      owner: input.owner,
      repo: input.repo,
      path: input.path,
    };
    if (input.ref !== undefined) {
      params.ref = input.ref;
    }

    const { data } = await octokit.rest.repos.getContent(params);

    // Ensure we got a directory listing
    if (!Array.isArray(data)) {
      return createErrorResult(context, "Path is not a directory");
    }

    const files = data.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type === "file" ? ("file" as const) : ("dir" as const),
      sha: item.sha,
      size: item.size,
    }));

    const output: ListFilesOutput = {
      files,
      count: files.length,
    };

    context.logger.info(
      {
        owner: input.owner,
        repo: input.repo,
        path: input.path,
        count: output.count,
      },
      "Files listed successfully",
    );

    return createToolResult(
      context,
      `Found ${output.count} item(s) in ${input.path || "root"}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to list files");
    return createErrorResult(
      context,
      `Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
