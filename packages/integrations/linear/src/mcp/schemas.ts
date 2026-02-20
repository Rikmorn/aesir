/**
 * Linear MCP Tool Schemas
 *
 * Zod schemas for validating MCP tool inputs and outputs.
 * Each tool has dedicated input and output schemas for type safety.
 */

import { z } from "zod";

// ===============================================
// GET ISSUE
// ===============================================

/**
 * Input schema for get_issue tool
 */
export const GetIssueInputSchema = z.object({
  /** Issue ID (UUID) or identifier (e.g., "ABC-123") */
  issueId: z.string().min(1, "Issue ID is required"),
});

export type GetIssueInput = z.infer<typeof GetIssueInputSchema>;

/**
 * Output schema for get_issue tool
 */
export const IssueOutputSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  state: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  team: z.object({
    id: z.string(),
    name: z.string(),
    key: z.string(),
  }),
  priority: z.number().nullable(),
  labels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
    }),
  ),
});

export type IssueOutput = z.infer<typeof IssueOutputSchema>;

// ===============================================
// CREATE ISSUE
// ===============================================

/**
 * Input schema for create_issue tool
 */
export const CreateIssueInputSchema = z.object({
  /** Team ID to create the issue in */
  teamId: z.string().min(1, "Team ID is required"),
  /** Issue title */
  title: z.string().min(1, "Title is required"),
  /** Issue description in markdown */
  description: z.string().optional(),
  /** Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low */
  priority: z
    .union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ])
    .optional(),
  /** Array of label IDs to apply */
  labelIds: z.array(z.string()).optional(),
  /** Parent issue ID for creating sub-issues */
  parentId: z.string().optional(),
});

export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

/**
 * Output schema for create_issue tool
 */
export const CreateIssueOutputSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  url: z.string(),
  title: z.string(),
});

export type CreateIssueOutput = z.infer<typeof CreateIssueOutputSchema>;

// ===============================================
// UPDATE ISSUE STATUS
// ===============================================

/**
 * Input schema for update_issue_status tool
 *
 * Supports two resolution modes:
 * - statusName: resolve by exact state name (e.g., "In Progress", "Done")
 * - stateType: resolve by state type (e.g., "completed", "canceled") -- team-agnostic
 *
 * When stateType is provided, it takes precedence over statusName.
 * At least one of statusName or stateType must be provided.
 */
export const UpdateIssueStatusInputSchema = z
  .object({
    /** Issue ID (UUID) or identifier (e.g., "ABC-123") */
    issueId: z.string().min(1, "Issue ID is required"),
    /** Target status name (e.g., "In Progress", "Done") */
    statusName: z.string().min(1, "Status name is required").optional(),
    /** Target state type. When provided, resolves the first workflow state matching this type. Takes precedence over statusName. */
    stateType: z
      .enum([
        "triage",
        "backlog",
        "unstarted",
        "started",
        "completed",
        "canceled",
      ])
      .optional(),
  })
  .refine(
    (data) => data.statusName !== undefined || data.stateType !== undefined,
    { message: "Either statusName or stateType must be provided" },
  );

export type UpdateIssueStatusInput = z.infer<
  typeof UpdateIssueStatusInputSchema
>;

/**
 * Output schema for update_issue_status tool
 */
export const UpdateIssueStatusOutputSchema = z.object({
  issueId: z.string(),
  statusName: z.string(),
  success: z.boolean(),
});

export type UpdateIssueStatusOutput = z.infer<
  typeof UpdateIssueStatusOutputSchema
>;

// ===============================================
// LIST TEAMS
// ===============================================

/**
 * Input schema for list_teams tool
 */
export const ListTeamsInputSchema = z.object({
  // No required inputs - lists all teams in workspace
});

export type ListTeamsInput = z.infer<typeof ListTeamsInputSchema>;

/**
 * Team schema
 */
export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
});

export type Team = z.infer<typeof TeamSchema>;

/**
 * Output schema for list_teams tool
 */
export const ListTeamsOutputSchema = z.object({
  teams: z.array(TeamSchema),
  count: z.number(),
});

export type ListTeamsOutput = z.infer<typeof ListTeamsOutputSchema>;

// ===============================================
// LIST LABELS
// ===============================================

/**
 * Input schema for list_labels tool
 */
export const ListLabelsInputSchema = z.object({
  /** Team ID to list labels for */
  teamId: z.string().min(1, "Team ID is required"),
});

export type ListLabelsInput = z.infer<typeof ListLabelsInputSchema>;

/**
 * Label schema
 */
export const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export type Label = z.infer<typeof LabelSchema>;

/**
 * Output schema for list_labels tool
 */
export const ListLabelsOutputSchema = z.object({
  labels: z.array(LabelSchema),
  count: z.number(),
  teamId: z.string(),
});

export type ListLabelsOutput = z.infer<typeof ListLabelsOutputSchema>;

// ===============================================
// SEARCH ISSUES
// ===============================================

/**
 * Input schema for search_issues tool
 */
export const SearchIssuesInputSchema = z.object({
  /** Text query to search for in issues */
  query: z.string().min(1, "Search query is required"),
  /** Optional team ID to scope search results */
  teamId: z.string().optional(),
  /** Maximum number of results to return (default: 10) */
  limit: z.number().optional(),
});

export type SearchIssuesInput = z.infer<typeof SearchIssuesInputSchema>;

/**
 * Single search result issue schema
 */
export const SearchIssueResultSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  state: z.object({
    name: z.string(),
    type: z.string(),
  }),
});

/**
 * Output schema for search_issues tool
 */
export const SearchIssuesOutputSchema = z.object({
  issues: z.array(SearchIssueResultSchema),
  count: z.number(),
  query: z.string(),
});

export type SearchIssuesOutput = z.infer<typeof SearchIssuesOutputSchema>;

// ===============================================
// CREATE COMMENT
// ===============================================

/**
 * Input schema for create_comment tool
 */
export const CreateCommentInputSchema = z.object({
  /** Issue ID (UUID) or identifier (e.g., "ABC-123") */
  issueId: z.string().min(1, "Issue ID is required"),
  /** Comment body in markdown format */
  body: z.string().min(1, "Comment body is required"),
});

export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

/**
 * Output schema for create_comment tool
 */
export const CreateCommentOutputSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export type CreateCommentOutput = z.infer<typeof CreateCommentOutputSchema>;

// ===============================================
// CREATE AGENT ACTIVITY
// ===============================================

export const CreateAgentActivityInputSchema = z.object({
  /** Agent session ID from the webhook payload */
  agentSessionId: z.string().min(1, "Agent session ID is required"),
  /** Activity type */
  type: z.enum(["thought", "action", "response", "error", "elicitation"]),
  /** Body text for thought, response, error, elicitation types */
  body: z.string().optional(),
  /** Action verb for action type (e.g., "Creating", "Reading") */
  action: z.string().optional(),
  /** Action parameter for action type (e.g., "branch feature/auth") */
  parameter: z.string().optional(),
  /** Action result for action type (optional completion message) */
  result: z.string().optional(),
  /** Ephemeral flag -- only valid for thought and action types */
  ephemeral: z.boolean().optional(),
});

export type CreateAgentActivityInput = z.infer<
  typeof CreateAgentActivityInputSchema
>;

export const CreateAgentActivityOutputSchema = z.object({
  success: z.boolean(),
  type: z.string(),
});

export type CreateAgentActivityOutput = z.infer<
  typeof CreateAgentActivityOutputSchema
>;

// ===============================================
// UPDATE SESSION STATE
// ===============================================

export const UpdateSessionStateInputSchema = z.object({
  /** Agent session ID */
  sessionId: z.string().min(1, "Session ID is required"),
  /** Target session status */
  status: z.enum(["pending", "active", "awaitingInput", "complete", "error"]),
});

export type UpdateSessionStateInput = z.infer<
  typeof UpdateSessionStateInputSchema
>;

export const UpdateSessionStateOutputSchema = z.object({
  success: z.boolean(),
  sessionId: z.string(),
  status: z.string(),
});

export type UpdateSessionStateOutput = z.infer<
  typeof UpdateSessionStateOutputSchema
>;
