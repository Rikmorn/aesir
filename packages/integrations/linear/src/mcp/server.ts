/**
 * Linear MCP Server Factory
 *
 * Creates and configures an MCP server for Linear operations.
 */

import type { PinoLogger } from "@aesir/platform";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  handleCreateComment,
  handleCreateIssue,
  handleGetIssue,
  handleListLabels,
  handleListTeams,
  handleSearchIssues,
  handleUpdateIssueStatus,
  type IssueToolDeps,
  type TeamToolDeps,
} from "./tools/index.js";

export interface LinearMCPServerOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  workspaceId?: string;
}

/**
 * Create a Linear MCP server with all tools registered
 *
 * @param options - Server configuration
 * @returns Configured MCP Server instance
 */
export function createLinearMCPServer(options: LinearMCPServerOptions): Server {
  const { db, logger, workspaceId = "ws_default" } = options;

  // Create server instance
  const server = new Server(
    {
      name: "linear-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Prepare shared dependencies
  const issueToolDeps: IssueToolDeps = { db, logger, workspaceId };
  const teamToolDeps: TeamToolDeps = { db, logger, workspaceId };

  // Register list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
                description:
                  "Maximum number of results to return (default: 10)",
              },
            },
            required: ["query"],
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
    // biome-ignore lint/suspicious/noImplicitAnyLet: Result type varies by tool handler
    let result;
    switch (toolName) {
      case "get_issue":
        result = await handleGetIssue(context, args, issueToolDeps);
        break;

      case "create_issue":
        result = await handleCreateIssue(context, args, issueToolDeps);
        break;

      case "update_issue_status":
        result = await handleUpdateIssueStatus(context, args, issueToolDeps);
        break;

      case "list_teams":
        result = await handleListTeams(context, args, teamToolDeps);
        break;

      case "list_labels":
        result = await handleListLabels(context, args, teamToolDeps);
        break;

      case "search_issues":
        result = await handleSearchIssues(context, args, issueToolDeps);
        break;

      case "create_comment":
        result = await handleCreateComment(context, args, issueToolDeps);
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

  logger.info("Linear MCP server created with 7 tools");

  return server;
}
