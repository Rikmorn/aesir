/**
 * Slack Integration Tools
 *
 * ToolDefinition factories for the 5 Slack MCP tools.
 * All Zod schemas are defined locally -- no imports from @aesir/integration-slack.
 *
 * Tools are prefixed with "slack_" to namespace them for the LLM.
 *
 * Note: Block Kit parameters (blocks) are intentionally omitted. Block Kit JSON
 * is complex to have the LLM construct correctly. Text-based messaging is
 * sufficient for agent communication. Block Kit support can be added later if needed.
 */

import { z } from "zod";
import type { ToolDefinition } from "../../agent-loop/types.js";
import { createMcpToolWrapper, type McpToolDeps } from "./mcp-wrapper.js";

// ---------------------------------------------------------------------------
// Input Schemas (locally defined, not imported from integration package)
// ---------------------------------------------------------------------------

const sendMessageSchema = z.object({
  channel: z.string().describe("Slack channel ID (e.g., 'C1234567890')"),
  text: z.string().describe("Message text (supports Slack mrkdwn formatting)"),
  threadTs: z
    .string()
    .optional()
    .describe(
      "Thread timestamp to reply in a thread instead of posting a new message",
    ),
});

const sendApprovalRequestSchema = z.object({
  channel: z
    .string()
    .describe("Slack channel ID to send the approval request to"),
  taskId: z
    .string()
    .describe("Task identifier displayed in the approval message"),
  title: z.string().describe("Title of the work requiring approval"),
  summary: z
    .string()
    .describe("Summary of what was done and what needs approval"),
  prUrl: z.string().optional().describe("URL of the pull request to review"),
  actionPrefix: z
    .string()
    .optional()
    .describe("Prefix for action IDs to distinguish approval flows"),
});

const getMessageSchema = z.object({
  channel: z.string().describe("Slack channel ID"),
  ts: z
    .string()
    .describe("Message timestamp (Slack's unique message identifier)"),
});

const replyToThreadSchema = z.object({
  channel: z.string().describe("Slack channel ID"),
  threadTs: z.string().describe("Parent message timestamp to reply to"),
  text: z.string().describe("Reply text (supports Slack mrkdwn formatting)"),
});

const listChannelsSchema = z.object({
  types: z
    .string()
    .optional()
    .describe(
      "Comma-separated channel types to include (e.g., 'public_channel,private_channel')",
    ),
  limit: z
    .number()
    .optional()
    .describe(
      "Maximum number of channels to return (default varies by Slack API)",
    ),
  excludeArchived: z
    .boolean()
    .optional()
    .describe("Whether to exclude archived channels from the list"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all Slack MCP tool definitions.
 *
 * Returns 5 tools for interacting with Slack via the MCP layer:
 * send_message, send_approval_request, get_message, reply_to_thread, list_channels.
 *
 * @param deps - Agent ID and correlation ID for MCP calls
 * @returns Array of 5 ToolDefinition objects
 */
export function createSlackTools(deps: McpToolDeps): ToolDefinition[] {
  return [
    createMcpToolWrapper(
      {
        integration: "slack",
        toolName: "send_message",
        displayName: "slack_send_message",
        description:
          "Send a message to a Slack channel. Supports Slack mrkdwn formatting for rich text. Optionally send as a thread reply by providing a thread timestamp. Use this to notify teams about progress, ask questions, or share results.",
        inputSchema: sendMessageSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "slack",
        toolName: "send_approval_request",
        displayName: "slack_send_approval_request",
        description:
          "Send an approval request with interactive buttons to a Slack channel. Creates a formatted message with task details and approve/reject buttons. Use this when work is ready for human review and an explicit approval or rejection is needed before proceeding.",
        inputSchema: sendApprovalRequestSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "slack",
        toolName: "get_message",
        displayName: "slack_get_message",
        description:
          "Retrieve a specific Slack message by its channel and timestamp. Returns the message text, sender, and metadata. Use this to read previous messages for context, check approval responses, or verify message delivery.",
        inputSchema: getMessageSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "slack",
        toolName: "reply_to_thread",
        displayName: "slack_reply_to_thread",
        description:
          "Reply to an existing Slack thread. Adds a message as a threaded reply to keep conversations organized. Use this to provide updates on ongoing tasks, respond to questions, or add context to a previous notification.",
        inputSchema: replyToThreadSchema,
      },
      deps,
    ),

    createMcpToolWrapper(
      {
        integration: "slack",
        toolName: "list_channels",
        displayName: "slack_list_channels",
        description:
          "List Slack channels available in the workspace. Returns channel names, IDs, and membership info. Use this to discover channels for notifications or to find the appropriate channel for a specific team or topic.",
        inputSchema: listChannelsSchema,
      },
      deps,
    ),
  ];
}
