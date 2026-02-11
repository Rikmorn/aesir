/**
 * MCP HTTP Routes for Linear Integration
 *
 * Exposes MCP tool endpoints via HTTP:
 * - GET /tools - List available tools
 * - POST /tools/:name - Invoke a specific tool
 *
 * Correlation ID and Agent ID are extracted from headers.
 */

import { generateCorrelationId, type PinoLogger } from "@aesir/platform";
import type { MCPToolContext, MCPToolResult } from "@aesir/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import rateLimit from "express-rate-limit";
import { recordTaskCorrelation } from "../db/task-correlations.js";
import {
  type ActivityToolDeps,
  handleCreateAgentActivity,
  handleCreateComment,
  handleCreateIssue,
  handleGetIssue,
  handleListLabels,
  handleListTeams,
  handleSearchIssues,
  handleUpdateIssueStatus,
  handleUpdateSessionState,
  type IssueToolDeps,
  type TeamToolDeps,
} from "../mcp/tools/index.js";

export interface CreateMCPRouterOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
  workspaceId?: string;
}

// Tool metadata for /tools listing
const TOOL_DEFINITIONS = [
  {
    name: "get_issue",
    description:
      "Retrieve details about a Linear issue. Use this when you need to check issue status, read description, or see who is assigned.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue ID or identifier (e.g., 'ABC-123')",
        },
      },
      required: ["issueId"],
    },
  },
  {
    name: "create_issue",
    description:
      "Create a new Linear issue in a team. Use this when you need to create a task, bug report, or feature request. Get teamId from list_teams first.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: {
          type: "string",
          description: "Linear team ID (get from list_teams)",
        },
        title: { type: "string", description: "Issue title" },
        description: {
          type: "string",
          description: "Issue description in markdown",
        },
        priority: {
          type: "number",
          description:
            "Priority: 0=no priority, 1=urgent, 2=high, 3=medium, 4=low",
          enum: [0, 1, 2, 3, 4],
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of label IDs (get from list_labels)",
        },
      },
      required: ["teamId", "title"],
    },
  },
  {
    name: "update_issue_status",
    description:
      "Update the workflow status of a Linear issue. Use this to move an issue through its workflow (e.g., To Do -> In Progress -> Done).",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue ID or identifier (e.g., 'ABC-123')",
        },
        statusName: {
          type: "string",
          description: "Target status name (e.g., 'In Progress', 'Done')",
        },
      },
      required: ["issueId", "statusName"],
    },
  },
  {
    name: "list_teams",
    description:
      "List all teams in the Linear workspace. Use this to get team IDs for creating issues.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_labels",
    description:
      "List labels for a specific team. Use this to get label IDs for tagging issues.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: {
          type: "string",
          description: "Team ID to list labels for",
        },
      },
      required: ["teamId"],
    },
  },
  {
    name: "create_comment",
    description:
      "Create a comment on a Linear issue. Use this to add notes, updates, or discussions to an issue.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue ID or identifier (e.g., 'ABC-123')",
        },
        body: {
          type: "string",
          description: "Comment body in markdown format",
        },
      },
      required: ["issueId", "body"],
    },
  },
  {
    name: "search_issues",
    description:
      "Search Linear issues by text query. Returns matching issues with titles, identifiers, and status. Use this to find existing issues before creating duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text query to search for in issues",
        },
        teamId: {
          type: "string",
          description: "Optional team ID to scope search results",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_agent_activity",
    description:
      "Create a typed activity on a Linear agent session. Use this to emit thoughts, actions, responses, errors, or elicitations during an agent session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: {
          type: "string",
          description: "Agent session ID from the webhook payload",
        },
        type: {
          type: "string",
          enum: ["thought", "action", "response", "error", "elicitation"],
          description: "Activity type",
        },
        body: {
          type: "string",
          description:
            "Body text for thought, response, error, elicitation types",
        },
        action: {
          type: "string",
          description:
            'Action verb for action type (e.g., "Creating", "Reading")',
        },
        parameter: {
          type: "string",
          description:
            'Action parameter for action type (e.g., "branch feature/auth")',
        },
        result: {
          type: "string",
          description:
            "Action result for action type (optional completion message)",
        },
        ephemeral: {
          type: "boolean",
          description:
            "Ephemeral flag -- only valid for thought and action types",
        },
      },
      required: ["agentSessionId", "type"],
    },
  },
  {
    name: "update_session_state",
    description:
      "Update the status of a Linear agent session. Use this for explicit session lifecycle transitions (e.g., marking complete or error state).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Agent session ID",
        },
        status: {
          type: "string",
          enum: ["pending", "active", "awaitingInput", "complete", "error"],
          description: "Target session status",
        },
      },
      required: ["sessionId", "status"],
    },
  },
];

/**
 * Create Express router for MCP endpoints
 */
export function createMCPRouter(options: CreateMCPRouterOptions): Router {
  const { db, logger, workspaceId = "ws_default" } = options;

  const router = createRouter();

  const childLogger = logger.child({
    component: "integrations:linear:api:mcp",
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
  const issueToolDeps: IssueToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    logger,
    workspaceId,
  };
  const teamToolDeps: TeamToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    logger,
    workspaceId,
  };
  const activityToolDeps: ActivityToolDeps = {
    db: db as unknown as PostgresJsDatabase,
    logger,
    workspaceId,
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
      const taskId = req.headers["x-task-id"] as string | undefined;
      const startTime = Date.now();

      const requestLogger = childLogger.child({
        correlationId,
        toolName: name,
        agentId,
        ...(taskId && { taskId }),
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
          ...(taskId !== undefined && { taskId }),
        };

        const args = req.body;

        // Route to appropriate handler
        let result: MCPToolResult;
        switch (name) {
          case "get_issue":
            result = await handleGetIssue(context, args, issueToolDeps);
            break;

          case "create_issue":
            result = await handleCreateIssue(context, args, issueToolDeps);
            if (!result.isError) {
              const data = result.structuredContent as
                | { id: string }
                | undefined;
              if (data?.id) {
                recordTaskCorrelation(
                  db,
                  taskId,
                  "issue",
                  data.id,
                  requestLogger,
                ).catch(() => {});
              }
            }
            break;

          case "update_issue_status":
            result = await handleUpdateIssueStatus(
              context,
              args,
              issueToolDeps,
            );
            break;

          case "list_teams":
            result = await handleListTeams(context, args, teamToolDeps);
            break;

          case "list_labels":
            result = await handleListLabels(context, args, teamToolDeps);
            break;

          case "create_comment":
            result = await handleCreateComment(context, args, issueToolDeps);
            if (!result.isError) {
              const data = result.structuredContent as
                | { id: string }
                | undefined;
              if (data?.id) {
                recordTaskCorrelation(
                  db,
                  taskId,
                  "comment",
                  data.id,
                  requestLogger,
                ).catch(() => {});
              }
            }
            break;

          case "search_issues":
            result = await handleSearchIssues(context, args, issueToolDeps);
            break;

          case "create_agent_activity":
            result = await handleCreateAgentActivity(
              context,
              args,
              activityToolDeps,
            );
            break;

          case "update_session_state":
            result = await handleUpdateSessionState(
              context,
              args,
              activityToolDeps,
            );
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
