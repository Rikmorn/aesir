/**
 * GitHub MCP Server Factory
 *
 * Creates and configures an MCP server for GitHub operations.
 */

import type { MCPToolResult } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { GitHubCredentialStore } from "../db/credential-store.js";
import {
  type FileToolDeps,
  handleGetFileContents,
  handleListFiles,
} from "./tools/files.js";
import {
  handleCreateBranch,
  handleCreateCommit,
  handleCreatePR,
  handleGetPR,
  handleListPRs,
  handleMergePR,
  type PRToolDeps,
} from "./tools/pullrequests.js";
import {
  handleGetRepository,
  type RepositoryToolDeps,
} from "./tools/repository.js";

export interface GitHubMCPServerOptions {
  db: PostgresJsDatabase;
  credentialStore: GitHubCredentialStore;
  logger: PinoLogger;
  owner: string;
}

/**
 * Create a GitHub MCP server with all tools registered
 *
 * @param options - Server configuration
 * @returns Configured MCP Server instance
 */
export function createGitHubMCPServer(options: GitHubMCPServerOptions): Server {
  const { db, credentialStore, logger, owner } = options;

  // Create server instance
  const server = new Server(
    {
      name: "github-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Prepare shared dependencies
  const repositoryDeps: RepositoryToolDeps = { db, credentialStore, owner };
  const prDeps: PRToolDeps = { db, credentialStore, owner };
  const fileDeps: FileToolDeps = { db, credentialStore, owner };

  // Register list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_repository",
          description: "Get information about a GitHub repository",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
            },
            required: ["owner", "repo"],
          },
        },
        {
          name: "create_branch",
          description: "Create a new branch from an existing branch",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              branchName: {
                type: "string",
                description: "Name for the new branch",
              },
              baseBranch: {
                type: "string",
                description: "Base branch to create from (default: main)",
              },
            },
            required: ["owner", "repo", "branchName"],
          },
        },
        {
          name: "create_commit",
          description: "Create a commit with file changes on a branch",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              branch: { type: "string", description: "Branch to commit to" },
              message: { type: "string", description: "Commit message" },
              files: {
                type: "array",
                description: "Files to add/modify",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string", description: "File path" },
                    content: { type: "string", description: "File content" },
                    mode: {
                      type: "string",
                      enum: ["100644", "100755", "040000", "160000", "120000"],
                      description: "File mode (default: 100644)",
                    },
                  },
                  required: ["path", "content"],
                },
              },
            },
            required: ["owner", "repo", "branch", "message", "files"],
          },
        },
        {
          name: "create_pull_request",
          description: "Create a new pull request",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              title: { type: "string", description: "PR title" },
              body: { type: "string", description: "PR description" },
              head: {
                type: "string",
                description: "Head branch (with changes)",
              },
              base: {
                type: "string",
                description: "Base branch (to merge into)",
              },
            },
            required: ["owner", "repo", "title", "head", "base"],
          },
        },
        {
          name: "get_pull_request",
          description: "Get information about a specific pull request",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              pullNumber: {
                type: "number",
                description: "Pull request number",
              },
            },
            required: ["owner", "repo", "pullNumber"],
          },
        },
        {
          name: "list_pull_requests",
          description: "List pull requests in a repository",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              state: {
                type: "string",
                enum: ["open", "closed", "all"],
                description: "PR state filter (default: open)",
              },
            },
            required: ["owner", "repo"],
          },
        },
        {
          name: "merge_pull_request",
          description: "Merge a pull request",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              pullNumber: {
                type: "number",
                description: "Pull request number",
              },
              mergeMethod: {
                type: "string",
                enum: ["merge", "squash", "rebase"],
                description: "Merge method (default: squash)",
              },
              commitTitle: { type: "string", description: "Commit title" },
              commitMessage: { type: "string", description: "Commit message" },
            },
            required: ["owner", "repo", "pullNumber"],
          },
        },
        {
          name: "get_file_contents",
          description: "Get the contents of a file from a repository",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              path: { type: "string", description: "File path" },
              ref: {
                type: "string",
                description:
                  "Branch, tag, or commit SHA (default: default branch)",
              },
            },
            required: ["owner", "repo", "path"],
          },
        },
        {
          name: "list_files",
          description: "List files in a directory",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner (user or organization)",
              },
              repo: { type: "string", description: "Repository name" },
              path: {
                type: "string",
                description: "Directory path (default: root)",
              },
              ref: {
                type: "string",
                description:
                  "Branch, tag, or commit SHA (default: default branch)",
              },
            },
            required: ["owner", "repo"],
          },
        },
      ],
    };
  });

  // Register call_tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName } = request.params;
    const args = request.params.arguments || {};

    // Extract context from request (added by MCP client)
    const context = {
      logger,
      correlationId: "unknown",
      agentId: "unknown",
      startTime: Date.now(),
    };

    // Route to appropriate handler and get result
    let result: MCPToolResult<unknown>;
    switch (toolName) {
      case "get_repository":
        result = await handleGetRepository(context, args, repositoryDeps);
        break;

      case "create_branch":
        result = await handleCreateBranch(context, args, prDeps);
        break;

      case "create_commit":
        result = await handleCreateCommit(context, args, prDeps);
        break;

      case "create_pull_request":
        result = await handleCreatePR(context, args, prDeps);
        break;

      case "get_pull_request":
        result = await handleGetPR(context, args, prDeps);
        break;

      case "list_pull_requests":
        result = await handleListPRs(context, args, prDeps);
        break;

      case "merge_pull_request":
        result = await handleMergePR(context, args, prDeps);
        break;

      case "get_file_contents":
        result = await handleGetFileContents(context, args, fileDeps);
        break;

      case "list_files":
        result = await handleListFiles(context, args, fileDeps);
        break;

      default:
        logger.warn({ toolName }, "Unknown tool requested");
        result = {
          content: [
            { type: "text" as const, text: `Unknown tool: ${toolName}` },
          ],
          meta: {
            duration_ms: Date.now() - context.startTime,
            correlation_id: context.correlationId,
          },
          isError: true,
        };
    }

    // Transform MCPToolResult to MCP SDK CallToolResult
    // Our result has { content, meta, structuredContent, isError }
    // SDK expects { content, _meta, isError }
    return {
      content: result.content,
      isError: result.isError,
    };
  });

  logger.info("GitHub MCP server created with 9 tools");

  return server;
}
