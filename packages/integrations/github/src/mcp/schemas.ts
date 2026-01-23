/**
 * GitHub MCP Tool Schemas
 *
 * Zod schemas for input validation and output typing of GitHub MCP tools.
 * Provides type-safe interfaces for all GitHub operations.
 */

import { z } from "zod";

// ============================================================================
// Repository Schemas
// ============================================================================

export const GetRepositoryInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
});

export type GetRepositoryInput = z.infer<typeof GetRepositoryInputSchema>;

export const RepositoryOutputSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  defaultBranch: z.string(),
  url: z.string(),
});

export type RepositoryOutput = z.infer<typeof RepositoryOutputSchema>;

// ============================================================================
// Branch Schemas
// ============================================================================

export const CreateBranchInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  branchName: z.string().min(1, "Branch name is required"),
  baseBranch: z.string().optional(),
});

export type CreateBranchInput = z.infer<typeof CreateBranchInputSchema>;

export const BranchOutputSchema = z.object({
  name: z.string(),
  sha: z.string(),
  protected: z.boolean(),
});

export type BranchOutput = z.infer<typeof BranchOutputSchema>;

// ============================================================================
// Commit Schemas
// ============================================================================

export const FileChangeSchema = z.object({
  path: z.string().min(1, "File path is required"),
  content: z.string(),
  mode: z.enum(["100644", "100755", "040000", "160000", "120000"]).optional(),
});

export const CreateCommitInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  branch: z.string().min(1, "Branch name is required"),
  message: z.string().min(1, "Commit message is required"),
  files: z.array(FileChangeSchema).min(1, "At least one file is required"),
});

export type CreateCommitInput = z.infer<typeof CreateCommitInputSchema>;

export const CommitOutputSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string(),
    date: z.string(),
  }),
});

export type CommitOutput = z.infer<typeof CommitOutputSchema>;

// ============================================================================
// Pull Request Schemas
// ============================================================================

export const CreatePRInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  title: z.string().min(1, "Title is required"),
  body: z.string().optional(),
  head: z.string().min(1, "Head branch is required"),
  base: z.string().min(1, "Base branch is required"),
});

export type CreatePRInput = z.infer<typeof CreatePRInputSchema>;

export const PROutputSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  headBranch: z.string(),
  baseBranch: z.string(),
  url: z.string(),
});

export type PROutput = z.infer<typeof PROutputSchema>;

export const GetPRInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  pullNumber: z.number().int().positive("Pull number must be positive"),
});

export type GetPRInput = z.infer<typeof GetPRInputSchema>;

export const ListPRsInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  state: z.enum(["open", "closed", "all"]).optional().default("open"),
});

export type ListPRsInput = z.infer<typeof ListPRsInputSchema>;

export const ListPRsOutputSchema = z.object({
  pullRequests: z.array(PROutputSchema),
  count: z.number(),
});

export type ListPRsOutput = z.infer<typeof ListPRsOutputSchema>;

export const MergePRInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  pullNumber: z.number().int().positive("Pull number must be positive"),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
});

export type MergePRInput = z.infer<typeof MergePRInputSchema>;

export const MergePROutputSchema = z.object({
  sha: z.string(),
  merged: z.boolean(),
  message: z.string(),
});

export type MergePROutput = z.infer<typeof MergePROutputSchema>;

// ============================================================================
// File Schemas
// ============================================================================

export const GetFileContentsInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  path: z.string().min(1, "File path is required"),
  ref: z.string().optional(), // branch, tag, or commit SHA
});

export type GetFileContentsInput = z.infer<typeof GetFileContentsInputSchema>;

export const FileContentsOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  sha: z.string(),
  size: z.number(),
  encoding: z.string(),
});

export type FileContentsOutput = z.infer<typeof FileContentsOutputSchema>;

export const ListFilesInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  path: z.string().optional().default(""), // directory path, empty = root
  ref: z.string().optional(), // branch, tag, or commit SHA
});

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "dir"]),
  sha: z.string(),
  size: z.number().optional(),
});

export const ListFilesOutputSchema = z.object({
  files: z.array(FileEntrySchema),
  count: z.number(),
});

export type ListFilesOutput = z.infer<typeof ListFilesOutputSchema>;
