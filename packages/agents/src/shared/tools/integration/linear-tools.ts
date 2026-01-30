/**
 * Linear Integration Tools
 *
 * ToolDefinition factories for the 5 Linear MCP tools.
 * All Zod schemas are defined locally -- no imports from @aesir/integration-linear.
 *
 * Tools are prefixed with "linear_" to avoid name collisions with other
 * integrations (e.g., GitHub also has issue concepts).
 */

import { z } from "zod";
import type { ToolDefinition } from "../../agent-loop/types.js";
import { createMcpToolWrapper, type McpToolDeps } from "./mcp-wrapper.js";

// ---------------------------------------------------------------------------
// Input Schemas (locally defined, not imported from integration package)
// ---------------------------------------------------------------------------

const getIssueSchema = z.object({
  issueId: z.string().describe("Linear issue identifier (e.g., 'ABC-123')"),
});

const createIssueSchema = z.object({
  teamId: z.string().describe("Linear team ID to create the issue in"),
  title: z.string().describe("Issue title"),
  description: z
    .string()
    .optional()
    .describe("Markdown description of the issue"),
  priority: z
    .number()
    .optional()
    .describe("Priority level (0=none, 1=urgent, 2=high, 3=medium, 4=low)"),
  labelIds: z
    .array(z.string())
    .optional()
    .describe("Array of label IDs to apply to the issue"),
});

const updateIssueStatusSchema = z.object({
  issueId: z.string().describe("Linear issue identifier (e.g., 'ABC-123')"),
  statusName: z
    .string()
    .describe("Target status name (e.g., 'In Progress', 'Done')"),
});

const listTeamsSchema = z.object({});

const listLabelsSchema = z.object({
  teamId: z.string().describe("Linear team ID to list labels for"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all Linear MCP tool definitions.
 *
 * Returns 5 tools for interacting with Linear via the MCP layer:
 * get_issue, create_issue, update_issue_status, list_teams, list_labels.
 *
 * @param deps - Agent ID and correlation ID for MCP calls
 * @returns Array of 5 ToolDefinition objects
 */
export function createLinearTools(deps: McpToolDeps): ToolDefinition[] {
  return [
    createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "get_issue",
        displayName: "linear_get_issue",
        description:
          "Retrieve details of a Linear issue by its identifier. Returns the issue title, description, status, assignee, labels, and other metadata. Use this to understand the current state of an issue before making changes or to gather context for implementation.",
        inputSchema: getIssueSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "create_issue",
        displayName: "linear_create_issue",
        description:
          "Create a new issue in a Linear team. Requires a team ID and title at minimum. Use this to create sub-tasks, follow-up issues, or new work items discovered during development. Returns the created issue details including its identifier.",
        inputSchema: createIssueSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "update_issue_status",
        displayName: "linear_update_issue_status",
        description:
          "Change the workflow status of a Linear issue. Use this to move issues through the workflow (e.g., from 'Todo' to 'In Progress' to 'Done'). The status name must match an existing workflow state for the issue's team.",
        inputSchema: updateIssueStatusSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "list_teams",
        displayName: "linear_list_teams",
        description:
          "List all teams in the Linear workspace. Returns team names and IDs. Use this to discover available teams when you need to create issues or look up team-specific information like labels and workflow states.",
        inputSchema: listTeamsSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "list_labels",
        displayName: "linear_list_labels",
        description:
          "List all labels available for a specific Linear team. Returns label names and IDs. Use this to find appropriate labels before creating or updating issues, ensuring correct categorization.",
        inputSchema: listLabelsSchema,
      },
      deps,
    ),
  ];
}
