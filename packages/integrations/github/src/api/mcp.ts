/**
 * MCP HTTP Routes for GitHub Integration
 *
 * Exposes MCP tool endpoints via HTTP:
 * - GET /mcp/tools - List available tools
 * - POST /mcp/tools/:name - Invoke a specific tool
 *
 * Correlation ID and Agent ID are extracted from headers.
 */

import {
  generateCorrelationId,
  type MCPToolContext,
  type MCPToolResult,
  type PinoLogger,
} from "@aesir/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import rateLimit from "express-rate-limit";
import type { GitHubCredentialStore } from "../db/credential-store.js";
import {
  type FileToolDeps,
  handleGetFileContents,
  handleListFiles,
} from "../mcp/tools/files.js";
import {
  handleCreateBranch,
  handleCreateCommit,
  handleCreatePR,
  handleGetPR,
  handleListPRs,
  handleMergePR,
  type PRToolDeps,
} from "../mcp/tools/pullrequests.js";
import {
  handleGetRepository,
  type RepositoryToolDeps,
} from "../mcp/tools/repository.js";

export interface CreateMCPRouterOptions {
  db: NodePgDatabase;
  credentialStore: GitHubCredentialStore;
  logger: PinoLogger;
  owner?: string;
}

// Tool metadata for /mcp/tools listing
const TOOL_DEFINITIONS = [
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
          description: "Branch, tag, or commit SHA (default: default branch)",
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
          description: "Branch, tag, or commit SHA (default: default branch)",
        },
      },
      required: ["owner", "repo"],
    },
  },
];

/**
 * Create Express router for MCP endpoints
 */
export function createMCPRouter(options: CreateMCPRouterOptions): Router {
  const { db, credentialStore, logger, owner = "default" } = options;

  const router = createRouter();

  const childLogger = logger.child({
    component: "integrations:github:api:mcp",
  });

  // Add rate limiting middleware - 100 requests per minute per agent
  const mcpRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per agent
    keyGenerator: (req) => {
      // Use agent ID as rate limit key
      return (req.headers["x-agent-id"] as string) || "unknown";
    },
    handler: (req, res) => {
      const agentId = req.headers["x-agent-id"] as string;
      const correlationId =
        (req.headers["x-correlation-id"] as string) || "unknown";

      childLogger.warn({ agentId, correlationId }, "MCP rate limit exceeded");

      res.status(429).json({
        error: "Rate limit exceeded. Try again later.",
        isError: true,
        meta: {
          correlation_id: correlationId,
          retry_after_seconds: 60,
        },
      });
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply rate limiter to all MCP routes
  // Type assertion: express-rate-limit has type version conflicts with Express Router
  router.use("/mcp/*", mcpRateLimiter as unknown as RequestHandler);

  // Prepare shared dependencies
  // Type assertion: NodePgDatabase and PostgresJsDatabase are compatible at runtime
  const repositoryDeps: RepositoryToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    credentialStore,
    owner,
  };
  const prDeps: PRToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    credentialStore,
    owner,
  };
  const fileDeps: FileToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    credentialStore,
    owner,
  };

  /**
   * List available MCP tools
   * GET /tools
   */
  router.get("/tools", async (req: Request, res: Response) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string) ||
      generateCorrelationId("api");
    const requestLogger = childLogger.child({ correlationId });

    requestLogger.info("MCP tools list request");

    res.json({
      tools: TOOL_DEFINITIONS,
      meta: { correlation_id: correlationId },
    });
  });

  /**
   * Invoke an MCP tool
   * POST /tools/:name
   *
   * Headers:
   * - X-Correlation-ID: Optional correlation ID for tracing
   * - X-Agent-ID: Required agent identifier for permission checks
   *
   * Body: Tool arguments as JSON
   */
  router.post(
    "/tools/:name",
    async (req: Request, res: Response): Promise<void> => {
      const { name } = req.params;
      const correlationId =
        (req.headers["x-correlation-id"] as string) ||
        generateCorrelationId("tool");
      const agentId = req.headers["x-agent-id"] as string;
      const startTime = Date.now();

      const requestLogger = childLogger.child({
        correlationId,
        toolName: name,
        agentId,
      });

      if (!agentId) {
        requestLogger.warn("Missing X-Agent-ID header");
        res.status(400).json({
          error: "X-Agent-ID header is required",
          meta: { correlation_id: correlationId },
        });
        return;
      }

      requestLogger.info({ input: req.body }, "MCP tool invocation started");

      try {
        // Create tool context
        const context: MCPToolContext = {
          logger: requestLogger,
          correlationId,
          agentId,
          startTime,
        };

        const args = req.body;

        // Route to appropriate handler
        let result: MCPToolResult;
        switch (name) {
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
            requestLogger.warn("Unknown tool requested");
            res.status(404).json({
              error: `Unknown tool: ${name}`,
              isError: true,
              meta: { correlation_id: correlationId },
            });
            return;
        }

        const durationMs = Date.now() - startTime;
        requestLogger.info(
          { durationMs, success: !result.isError },
          "MCP tool invocation completed",
        );

        res.json({
          ...result,
          meta: {
            ...result.meta,
            correlation_id: correlationId,
            duration_ms: durationMs,
          },
        });
      } catch (error) {
        const durationMs = Date.now() - startTime;
        requestLogger.error(
          { err: error, durationMs },
          "MCP tool invocation failed",
        );
        res.status(500).json({
          error: `Tool invocation failed: ${(error as Error).message}`,
          isError: true,
          meta: { correlation_id: correlationId, duration_ms: durationMs },
        });
      }
    },
  );

  return router;
}
