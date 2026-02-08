/**
 * GitHub MCP Pull Request Tools
 *
 * Tool handlers for PR operations.
 */

import type { MCPToolContext, MCPToolResult } from "@aesir/types";
import { createErrorResult, createToolResult } from "@aesir/types";
import type { Octokit } from "@octokit/rest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GitHubCredentialStore } from "../../db/credential-store.js";
import { checkGitHubToolPermission } from "../../db/permissions.js";
import { createGitHubClientFromDatabase } from "../../oauth/flow.js";
import {
  createBranch as createBranchOp,
  createCommit as createCommitOp,
} from "../../operations/index.js";
import {
  addPRComment,
  createPullRequest as createPRInternal,
  getPullRequest as getPRInternal,
  mergePullRequest as mergePRInternal,
} from "../../operations/pull-requests.js";
import {
  type BranchOutput,
  type CommitOutput,
  CreateBranchInputSchema,
  CreateCommitInputSchema,
  CreatePRCommentInputSchema,
  CreatePRInputSchema,
  GetPRInputSchema,
  ListPRsInputSchema,
  type ListPRsOutput,
  MergePRInputSchema,
  type MergePROutput,
  type PRCommentOutput,
  type PROutput,
} from "../schemas.js";

export interface PRToolDeps {
  db: PostgresJsDatabase;
  credentialStore: GitHubCredentialStore;
  owner: string;
}

/**
 * Handle create_branch tool call
 */
export async function handleCreateBranch(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<BranchOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_branch" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_branch" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_branch not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreateBranchInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_branch",
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

    // Build options with conditional property assignment (exactOptionalPropertyTypes)
    const options: {
      owner: string;
      repo: string;
      branchName: string;
      baseBranch?: string;
    } = {
      owner: input.owner,
      repo: input.repo,
      branchName: input.branchName,
    };
    if (input.baseBranch !== undefined) {
      options.baseBranch = input.baseBranch;
    }

    const branch = await createBranchOp(octokit, options);

    const output: BranchOutput = {
      name: branch.name,
      sha: branch.sha,
      protected: branch.protected,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, branch: branch.name },
      "Branch created successfully",
    );

    return createToolResult(
      context,
      `Branch created: ${branch.name} (${branch.sha})`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to create branch");
    return createErrorResult(
      context,
      `Failed to create branch: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle create_commit tool call
 */
export async function handleCreateCommit(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<CommitOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_commit" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_commit" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_commit not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreateCommitInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_commit",
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

    // Map files with conditional mode assignment (exactOptionalPropertyTypes)
    const files = input.files.map((file) => {
      const fileChange: {
        path: string;
        content: string;
        mode?: "100644" | "100755" | "040000" | "160000" | "120000";
      } = {
        path: file.path,
        content: file.content,
      };
      if (file.mode !== undefined) {
        fileChange.mode = file.mode;
      }
      return fileChange;
    });

    const commit = await createCommitOp(octokit, {
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      message: input.message,
      files,
    });

    const output: CommitOutput = {
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, sha: commit.sha },
      "Commit created successfully",
    );

    return createToolResult(
      context,
      `Commit created: ${commit.sha}\nMessage: ${commit.message}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to create commit");
    return createErrorResult(
      context,
      `Failed to create commit: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle create_pull_request tool call
 */
export async function handleCreatePR(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<PROutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_pull_request" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_pull_request" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_pull_request not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreatePRInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_pull_request",
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

    // Build options with conditional property assignment (exactOptionalPropertyTypes)
    const options: {
      owner: string;
      repo: string;
      title: string;
      body?: string;
      head: string;
      base: string;
    } = {
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      head: input.head,
      base: input.base,
    };
    if (input.body !== undefined) {
      options.body = input.body;
    }

    const pr = await createPRInternal(octokit, options);

    const output: PROutput = {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      url: pr.url,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, prNumber: pr.number },
      "Pull request created successfully",
    );

    return createToolResult(
      context,
      `Pull request created: #${pr.number}\nTitle: ${pr.title}\nURL: ${pr.url}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to create PR");
    return createErrorResult(
      context,
      `Failed to create pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle get_pull_request tool call
 */
export async function handleGetPR(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<PROutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "get_pull_request" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "get_pull_request" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: get_pull_request not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = GetPRInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for get_pull_request",
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

    const pr = await getPRInternal(
      octokit,
      input.owner,
      input.repo,
      input.pullNumber,
    );

    const output: PROutput = {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      url: pr.url,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, prNumber: pr.number },
      "Pull request fetched successfully",
    );

    return createToolResult(
      context,
      `Pull request #${pr.number}\nTitle: ${pr.title}\nState: ${pr.state}\nURL: ${pr.url}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to get PR");
    return createErrorResult(
      context,
      `Failed to get pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle list_pull_requests tool call
 */
export async function handleListPRs(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<ListPRsOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "list_pull_requests" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "list_pull_requests" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: list_pull_requests not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = ListPRsInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for list_pull_requests",
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

    // List PRs
    const { data: prs } = await octokit.rest.pulls.list({
      owner: input.owner,
      repo: input.repo,
      state: input.state,
    });

    const pullRequests: PROutput[] = prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state as "open" | "closed",
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      url: pr.html_url,
    }));

    const output: ListPRsOutput = {
      pullRequests,
      count: pullRequests.length,
    };

    context.logger.info(
      { owner: input.owner, repo: input.repo, count: output.count },
      "Pull requests listed successfully",
    );

    return createToolResult(
      context,
      `Found ${output.count} pull request(s)`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to list PRs");
    return createErrorResult(
      context,
      `Failed to list pull requests: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle merge_pull_request tool call
 */
export async function handleMergePR(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<MergePROutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "merge_pull_request" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "merge_pull_request" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: merge_pull_request not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = MergePRInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for merge_pull_request",
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

    // Build options with conditional property assignment (exactOptionalPropertyTypes)
    const options: {
      mergeMethod?: "merge" | "squash" | "rebase";
      commitTitle?: string;
      commitMessage?: string;
    } = {};
    if (input.mergeMethod !== undefined) {
      options.mergeMethod = input.mergeMethod;
    }
    if (input.commitTitle !== undefined) {
      options.commitTitle = input.commitTitle;
    }
    if (input.commitMessage !== undefined) {
      options.commitMessage = input.commitMessage;
    }

    const result = await mergePRInternal(
      octokit,
      input.owner,
      input.repo,
      input.pullNumber,
      options,
    );

    const output: MergePROutput = {
      sha: result.sha,
      merged: result.merged,
      message: `Pull request #${input.pullNumber} merged successfully`,
    };

    context.logger.info(
      {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.pullNumber,
        sha: result.sha,
      },
      "Pull request merged successfully",
    );

    return createToolResult(
      context,
      `Pull request #${input.pullNumber} merged\nCommit: ${result.sha}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to merge PR");
    return createErrorResult(
      context,
      `Failed to merge pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle create_pr_comment tool call
 */
export async function handleCreatePRComment(
  context: MCPToolContext,
  args: unknown,
  deps: PRToolDeps,
): Promise<MCPToolResult<PRCommentOutput>> {
  const { db, credentialStore, owner } = deps;

  // Check permission
  const hasPermission = await checkGitHubToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_pr_comment" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_pr_comment" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_pr_comment not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreatePRCommentInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_pr_comment",
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

    const comment = await addPRComment(
      octokit,
      input.owner,
      input.repo,
      input.pullNumber,
      input.body,
    );

    const output: PRCommentOutput = {
      id: comment.id,
      body: comment.body,
      user: comment.user,
      createdAt: comment.createdAt,
    };

    context.logger.info(
      {
        owner: input.owner,
        repo: input.repo,
        pullNumber: input.pullNumber,
        commentId: comment.id,
      },
      "PR comment created successfully",
    );

    return createToolResult(
      context,
      `Comment added to PR #${input.pullNumber}`,
      output,
    );
  } catch (error) {
    context.logger.error({ err: error, input }, "Failed to create PR comment");
    return createErrorResult(
      context,
      `Failed to create PR comment: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
