/**
 * Slack MCP Server Factory
 *
 * Creates and configures an MCP server for Slack operations.
 */

import type { MCPLogger, MCPToolContext } from "@aesir/types";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Block, KnownBlock } from "@slack/web-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createSlackClientFromDatabase } from "../client/factory.js";
import { createSlackCredentialStore } from "../db/credential-store.js";
import { checkSlackToolPermission } from "../db/permissions.js";
import { sendApprovalRequest, sendMessage } from "../messages/sender.js";
import type { ApprovalNotification } from "../messages/types.js";
import {
  ApprovalRequestOutputSchema,
  ChannelSchema,
  GetMessageInputSchema,
  type GetMessageOutput,
  ListChannelsInputSchema,
  MessageOutputSchema,
  ReplyToThreadInputSchema,
  SendApprovalRequestInputSchema,
  SendMessageInputSchema,
} from "./schemas.js";

export interface SlackMCPServerOptions {
  db: PostgresJsDatabase | NodePgDatabase;
  logger: MCPLogger;
  teamId?: string;
}

/**
 * Create a Slack MCP server with all tools registered
 *
 * @param options - Server configuration
 * @returns Configured MCP Server instance
 */
export function createSlackMCPServer(options: SlackMCPServerOptions): Server {
  const { db, logger, teamId = "default" } = options;

  // Create server instance
  const server = new Server(
    {
      name: "slack-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Create credential store once
  // Type assertion: NodePgDatabase and PostgresJsDatabase are compatible at runtime
  const credentialStore = createSlackCredentialStore({
    db: db as NodePgDatabase,
    logger,
  });

  // Register list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
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
          name: "list_channels",
          description:
            "List available Slack channels. Returns channel names, IDs, and metadata. Use to discover channels before sending messages.",
          inputSchema: zodToJsonSchema(ListChannelsInputSchema),
        },
      ],
    };
  });

  // Register call_tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName } = request.params;
    const args = (request.params.arguments || {}) as Record<string, unknown>;

    // Extract context from request (added by MCP client)
    const context: MCPToolContext = {
      logger,
      correlationId: "unknown",
      agentId: "unknown",
      startTime: Date.now(),
    };

    // Check permission
    // Type assertion: NodePgDatabase and PostgresJsDatabase are compatible at runtime
    const hasPermission = await checkSlackToolPermission(
      { db: db as NodePgDatabase, logger: context.logger },
      { agentId: context.agentId, toolName },
    );

    if (!hasPermission) {
      logger.warn(
        { agentId: context.agentId, toolName },
        "Permission denied for tool",
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Permission denied: ${toolName} not allowed for agent ${context.agentId}`,
          },
        ],
        isError: true,
      };
    }

    // Create Slack client
    let client: Awaited<ReturnType<typeof createSlackClientFromDatabase>>;
    try {
      client = await createSlackClientFromDatabase({
        teamId,
        credentialStore,
        logger: context.logger,
      });
    } catch (error) {
      logger.error({ err: error, teamId }, "Failed to create Slack client");
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create Slack client";
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }

    // Route to appropriate handler and get result
    let result: {
      content: Array<{ type: "text"; text: string }>;
      isError: boolean;
    };
    try {
      switch (toolName) {
        case "send_message": {
          const validation = SendMessageInputSchema.safeParse(args);
          if (!validation.success) {
            logger.warn(
              { error: validation.error.message },
              "Invalid send_message input",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid input: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
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

          const sendResult = await sendMessage(sendOptions);

          const output = MessageOutputSchema.parse({
            ts: sendResult.ts,
            channel: sendResult.channel,
          });

          result = {
            content: [
              {
                type: "text" as const,
                text: `Message sent successfully to ${output.channel}`,
              },
            ],
            isError: false,
          };
          break;
        }

        case "send_approval_request": {
          const validation = SendApprovalRequestInputSchema.safeParse(args);
          if (!validation.success) {
            logger.warn(
              { error: validation.error.message },
              "Invalid send_approval_request input",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid input: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const input = validation.data;
          const notification: ApprovalNotification = {
            type: "approval_needed",
            taskId: input.taskId,
            title: input.title,
            summary: input.summary,
            prUrl: input.prUrl || "",
          };

          const approvalResult = await sendApprovalRequest(
            client,
            notification,
            input.channel,
          );

          const output = ApprovalRequestOutputSchema.parse({
            ts: approvalResult.ts,
            channel: approvalResult.channel,
            actionIds: {
              approve: `${input.actionPrefix}_pr`,
              reject: "reject_pr",
            },
          });

          result = {
            content: [
              {
                type: "text" as const,
                text: `Approval request sent to ${output.channel}`,
              },
            ],
            isError: false,
          };
          break;
        }

        case "get_message": {
          const validation = GetMessageInputSchema.safeParse(args);
          if (!validation.success) {
            logger.warn(
              { error: validation.error.message },
              "Invalid get_message input",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid input: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const input = validation.data;
          const historyResult = await client.conversations.history({
            channel: input.channel,
            latest: input.ts,
            inclusive: true,
            limit: 1,
          });

          if (!historyResult.messages || historyResult.messages.length === 0) {
            logger.warn(
              { channel: input.channel, ts: input.ts },
              "Message not found",
            );
            return {
              content: [{ type: "text" as const, text: "Message not found" }],
              isError: true,
            };
          }

          const message = historyResult.messages[0];

          if (!message) {
            logger.warn(
              { channel: input.channel, ts: input.ts },
              "Message not found",
            );
            return {
              content: [{ type: "text" as const, text: "Message not found" }],
              isError: true,
            };
          }

          const output: GetMessageOutput = {
            ts: message.ts || input.ts,
            text: message.text || "",
            user: message.user,
            threadTs: message.thread_ts,
            replyCount: message.reply_count,
          };

          result = {
            content: [
              {
                type: "text" as const,
                text: `Retrieved message from ${input.channel}: ${output.text}`,
              },
            ],
            isError: false,
          };
          break;
        }

        case "reply_to_thread": {
          const validation = ReplyToThreadInputSchema.safeParse(args);
          if (!validation.success) {
            logger.warn(
              { error: validation.error.message },
              "Invalid reply_to_thread input",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid input: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
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

          const replyResult = await sendMessage(replyOptions);

          // Validate result structure
          MessageOutputSchema.parse({
            ts: replyResult.ts,
            channel: replyResult.channel,
          });

          result = {
            content: [
              {
                type: "text" as const,
                text: `Reply sent to thread ${input.threadTs}`,
              },
            ],
            isError: false,
          };
          break;
        }

        case "list_channels": {
          const validation = ListChannelsInputSchema.safeParse(args);
          if (!validation.success) {
            logger.warn(
              { error: validation.error.message },
              "Invalid list_channels input",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid input: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const input = validation.data;
          const channelsResult = await client.conversations.list({
            types: input.types,
            limit: input.limit,
            exclude_archived: input.excludeArchived,
          });

          if (!channelsResult.channels) {
            logger.warn("No channels returned from API");
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No channels returned from API",
                },
              ],
              isError: true,
            };
          }

          const channels = channelsResult.channels.map((channel) => {
            return ChannelSchema.parse({
              id: channel.id,
              name: channel.name,
              isPrivate: channel.is_private || false,
              memberCount: channel.num_members,
              topic: channel.topic?.value,
            });
          });

          result = {
            content: [
              {
                type: "text" as const,
                text: `Found ${channels.length} channels: ${channels.map((c) => c.name).join(", ")}`,
              },
            ],
            isError: false,
          };
          break;
        }

        default:
          logger.warn({ toolName }, "Unknown tool requested");
          result = {
            content: [
              { type: "text" as const, text: `Unknown tool: ${toolName}` },
            ],
            isError: true,
          };
      }
    } catch (error) {
      logger.error({ err: error, toolName }, "Tool execution failed");

      const message =
        error instanceof Error ? error.message : "Unknown error occurred";

      result = {
        content: [
          { type: "text" as const, text: `Tool execution failed: ${message}` },
        ],
        isError: true,
      };
    }

    return result;
  });

  logger.info("Slack MCP server created with 5 tools");

  return server;
}
