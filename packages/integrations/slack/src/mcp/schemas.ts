/**
 * Zod schemas for Slack MCP tools
 *
 * Defines input and output schemas for all Slack MCP tools.
 * Schemas are used for:
 * 1. Runtime validation of tool inputs
 * 2. JSON Schema generation for MCP tool registration
 * 3. Type inference for TypeScript
 */

import { z } from "zod";

// === MESSAGE TOOLS ===

export const SendMessageInputSchema = z.object({
  channel: z
    .string()
    .describe("Channel ID (e.g., C1234567890) or user ID for DM"),
  text: z
    .string()
    .min(1)
    .describe("Message text (used as fallback if blocks fail)"),
  blocks: z
    .array(z.any())
    .optional()
    .describe("Optional Block Kit blocks for rich formatting"),
  threadTs: z
    .string()
    .optional()
    .describe("Thread timestamp to reply in thread"),
});

export const MessageOutputSchema = z.object({
  ts: z.string().describe("Message timestamp (unique ID)"),
  channel: z.string(),
  permalink: z.string().url().optional(),
});

export const SendApprovalRequestInputSchema = z.object({
  channel: z.string().describe("Channel ID to post approval request"),
  taskId: z.string().describe("Task/issue identifier (e.g., 'ABC-123')"),
  title: z.string().describe("Title of the item needing approval"),
  summary: z.string().describe("Brief summary of changes"),
  prUrl: z
    .string()
    .url()
    .optional()
    .describe("Link to pull request if applicable"),
  actionPrefix: z
    .string()
    .default("approve")
    .describe("Prefix for action IDs (default: 'approve')"),
});

export const ApprovalRequestOutputSchema = z.object({
  ts: z.string(),
  channel: z.string(),
  actionIds: z.object({
    approve: z.string(),
    reject: z.string(),
  }),
});

export const GetMessageInputSchema = z.object({
  channel: z.string().describe("Channel ID"),
  ts: z.string().describe("Message timestamp"),
});

export const GetMessageOutputSchema = z.object({
  ts: z.string(),
  text: z.string(),
  user: z.string().optional(),
  threadTs: z.string().optional(),
  replyCount: z.number().optional(),
});

export const ReplyToThreadInputSchema = z.object({
  channel: z.string().describe("Channel ID"),
  threadTs: z.string().describe("Thread parent timestamp"),
  text: z.string().min(1).describe("Reply text"),
  blocks: z.array(z.any()).optional().describe("Optional Block Kit blocks"),
});

// === CHANNEL TOOLS ===

export const ListChannelsInputSchema = z.object({
  types: z
    .string()
    .default("public_channel,private_channel")
    .describe("Channel types (comma-separated)"),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Maximum channels to return"),
  excludeArchived: z
    .boolean()
    .default(true)
    .describe("Exclude archived channels"),
});

export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrivate: z.boolean(),
  memberCount: z.number().optional(),
  topic: z.string().optional(),
});

export const ListChannelsOutputSchema = z.object({
  channels: z.array(ChannelSchema),
});

// Type exports
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type MessageOutput = z.infer<typeof MessageOutputSchema>;
export type SendApprovalRequestInput = z.infer<
  typeof SendApprovalRequestInputSchema
>;
export type ApprovalRequestOutput = z.infer<typeof ApprovalRequestOutputSchema>;
export type GetMessageInput = z.infer<typeof GetMessageInputSchema>;
export type GetMessageOutput = z.infer<typeof GetMessageOutputSchema>;
export type ReplyToThreadInput = z.infer<typeof ReplyToThreadInputSchema>;
export type ListChannelsInput = z.infer<typeof ListChannelsInputSchema>;
export type ListChannelsOutput = z.infer<typeof ListChannelsOutputSchema>;
