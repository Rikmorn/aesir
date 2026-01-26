/**
 * Slack MCP Tools - Messages
 *
 * Provides MCP tools for Slack messaging operations:
 * - send_message: Send a message to a channel or DM
 * - send_approval_request: Send an approval request with buttons
 * - get_message: Retrieve a message by timestamp
 * - reply_to_thread: Reply to a thread
 */

import {
  createErrorResult,
  createToolResult,
  type MCPToolContext,
  type PinoLogger,
} from "@aesir/common";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Block, KnownBlock } from "@slack/web-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createSlackClientFromDatabase } from "../../client/factory.js";
import { createSlackCredentialStore } from "../../db/credential-store.js";
import { checkSlackToolPermission } from "../../db/permissions.js";
import { sendApprovalRequest, sendMessage } from "../../messages/sender.js";
import type { ApprovalNotification } from "../../messages/types.js";
import {
  ApprovalRequestOutputSchema,
  GetMessageInputSchema,
  type GetMessageOutput,
  MessageOutputSchema,
  ReplyToThreadInputSchema,
  SendApprovalRequestInputSchema,
  SendMessageInputSchema,
  UpdateMessageInputSchema,
  UpdateMessageOutputSchema,
} from "../schemas.js";

export interface RegisterMessageToolsDeps {
  server: Server;
  db: NodePgDatabase;
  logger: PinoLogger;
  teamId: string;
}

/**
 * Register message-related tools on the MCP server
 */
export function registerMessageTools(deps: RegisterMessageToolsDeps): void {
  const { server, db, logger, teamId } = deps;

  // Create credential store once for all tools
  const credentialStore = createSlackCredentialStore({ db, logger });

  // === SEND_MESSAGE ===

  // @ts-expect-error MCP SDK type mismatch - setRequestHandler expects different signature
  server.setRequestHandler("tools/list", async () => {
    return {
      tools: [
        {
          name: "send_message",
          description:
            "Send a message to a Slack channel or direct message. Supports plain text and Block Kit formatting.",
          inputSchema: zodToJsonSchema(SendMessageInputSchema),
        },
        {
          name: "send_approval_request",
          description:
            "Send an approval request message with approve/reject buttons. Used for PR reviews and task approvals.",
          inputSchema: zodToJsonSchema(SendApprovalRequestInputSchema),
        },
        {
          name: "get_message",
          description:
            "Retrieve a message by timestamp. Returns message content, author, and thread information.",
          inputSchema: zodToJsonSchema(GetMessageInputSchema),
        },
        {
          name: "reply_to_thread",
          description:
            "Reply to a specific thread. Creates a threaded reply in the conversation.",
          inputSchema: zodToJsonSchema(ReplyToThreadInputSchema),
        },
        {
          name: "update_message",
          description:
            "Update an existing Slack message. Can change text and/or blocks. At least one of text or blocks must be provided.",
          inputSchema: zodToJsonSchema(UpdateMessageInputSchema),
        },
      ],
    };
  });

  // @ts-expect-error MCP SDK type mismatch - setRequestHandler expects different signature
  server.setRequestHandler("tools/call", async (request) => {
    const toolName = request.params.name;

    // Extract context from arguments
    const args = request.params.arguments as Record<string, unknown> & {
      correlationId?: string;
      agentId?: string;
      startTime?: number;
    };

    const context: MCPToolContext = {
      logger: logger.child({ correlationId: args.correlationId || "unknown" }),
      correlationId: args.correlationId || "unknown",
      agentId: args.agentId || "unknown",
      startTime: args.startTime || Date.now(),
    };

    // Check permission
    const hasPermission = await checkSlackToolPermission(
      { db, logger: context.logger },
      { agentId: context.agentId, toolName },
    );

    if (!hasPermission) {
      return createErrorResult(
        context,
        `Permission denied: ${toolName} not allowed for agent ${context.agentId}`,
      );
    }

    try {
      // Create Slack client
      const client = await createSlackClientFromDatabase({
        teamId,
        credentialStore,
        logger: context.logger,
      });

      // Handle tool invocation
      switch (toolName) {
        case "send_message": {
          const validation = SendMessageInputSchema.safeParse(args);
          if (!validation.success) {
            return createErrorResult(
              context,
              `Invalid input: ${validation.error.message}`,
            );
          }

          const input = validation.data;

          // Build options object conditionally for exactOptionalPropertyTypes
          const sendOptions: {
            client: typeof client;
            channel: string;
            text: string;
            blocks?: (Block | KnownBlock)[];
            threadTs?: string;
          } = {
            client,
            channel: input.channel,
            text: input.text,
          };

          if (input.blocks !== undefined) {
            sendOptions.blocks = input.blocks as (Block | KnownBlock)[];
          }
          if (input.threadTs !== undefined) {
            sendOptions.threadTs = input.threadTs;
          }

          const result = await sendMessage(sendOptions);

          const output = MessageOutputSchema.parse({
            ts: result.ts,
            channel: result.channel,
          });

          return createToolResult(
            context,
            `Message sent successfully to ${output.channel}`,
            output,
          );
        }

        case "send_approval_request": {
          const validation = SendApprovalRequestInputSchema.safeParse(args);
          if (!validation.success) {
            return createErrorResult(
              context,
              `Invalid input: ${validation.error.message}`,
            );
          }

          const input = validation.data;
          const notification: ApprovalNotification = {
            type: "approval_needed",
            taskId: input.taskId,
            title: input.title,
            summary: input.summary,
            prUrl: input.prUrl || "",
          };

          const result = await sendApprovalRequest(
            client,
            notification,
            input.channel,
          );

          const output = ApprovalRequestOutputSchema.parse({
            ts: result.ts,
            channel: result.channel,
            actionIds: {
              approve: `${input.actionPrefix}_pr`,
              reject: "reject_pr",
            },
          });

          return createToolResult(
            context,
            `Approval request sent to ${output.channel}`,
            output,
          );
        }

        case "get_message": {
          const validation = GetMessageInputSchema.safeParse(args);
          if (!validation.success) {
            return createErrorResult(
              context,
              `Invalid input: ${validation.error.message}`,
            );
          }

          const input = validation.data;
          const result = await client.conversations.history({
            channel: input.channel,
            latest: input.ts,
            inclusive: true,
            limit: 1,
          });

          if (!result.messages || result.messages.length === 0) {
            return createErrorResult(context, "Message not found");
          }

          const message = result.messages[0];

          if (!message) {
            return createErrorResult(context, "Message not found");
          }

          const output: GetMessageOutput = {
            ts: message.ts || input.ts,
            text: message.text || "",
            user: message.user,
            threadTs: message.thread_ts,
            replyCount: message.reply_count,
          };

          return createToolResult(
            context,
            `Retrieved message from ${input.channel}`,
            output,
          );
        }

        case "reply_to_thread": {
          const validation = ReplyToThreadInputSchema.safeParse(args);
          if (!validation.success) {
            return createErrorResult(
              context,
              `Invalid input: ${validation.error.message}`,
            );
          }

          const input = validation.data;

          // Build options object conditionally for exactOptionalPropertyTypes
          const replyOptions: {
            client: typeof client;
            channel: string;
            text: string;
            blocks?: (Block | KnownBlock)[];
            threadTs: string;
          } = {
            client,
            channel: input.channel,
            text: input.text,
            threadTs: input.threadTs,
          };

          if (input.blocks !== undefined) {
            replyOptions.blocks = input.blocks as (Block | KnownBlock)[];
          }

          const result = await sendMessage(replyOptions);

          const output = MessageOutputSchema.parse({
            ts: result.ts,
            channel: result.channel,
          });

          return createToolResult(
            context,
            `Reply sent to thread ${input.threadTs}`,
            output,
          );
        }

        case "update_message": {
          const validation = UpdateMessageInputSchema.safeParse(args);
          if (!validation.success) {
            return createErrorResult(
              context,
              `Invalid input: ${validation.error.message}`,
            );
          }

          const input = validation.data;

          // Slack requires at least one of text or blocks
          if (!input.text && !input.blocks) {
            return createErrorResult(
              context,
              "Invalid input: at least one of text or blocks must be provided",
            );
          }

          // Build update options - ChatUpdateArguments requires text or blocks
          // We validated above that at least one is present
          const result = await client.chat.update({
            channel: input.channel,
            ts: input.ts,
            text: input.text ?? "",
            ...(input.blocks !== undefined && {
              blocks: input.blocks as (Block | KnownBlock)[],
            }),
          });

          const output = UpdateMessageOutputSchema.parse({
            ts: result.ts,
            channel: result.channel,
          });

          return createToolResult(
            context,
            `Message updated in ${output.channel}`,
            output,
          );
        }

        default:
          return createErrorResult(context, `Unknown tool: ${toolName}`);
      }
    } catch (error) {
      context.logger.error({ err: error, toolName }, "Tool execution failed");

      const message =
        error instanceof Error ? error.message : "Unknown error occurred";

      return createErrorResult(context, `Tool execution failed: ${message}`);
    }
  });
}
