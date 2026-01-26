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
 */
export const UpdateIssueStatusInputSchema = z.object({
  /** Issue ID (UUID) or identifier (e.g., "ABC-123") */
  issueId: z.string().min(1, "Issue ID is required"),
  /** Target status name (e.g., "In Progress", "Done") */
  statusName: z.string().min(1, "Status name is required"),
});

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
