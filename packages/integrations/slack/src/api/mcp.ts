/**
 * MCP HTTP Routes for Slack Integration
 *
 * Exposes MCP tool endpoints via HTTP:
 * - GET /mcp/tools - List available tools
 * - POST /mcp/tools/:name - Invoke a specific tool
 *
 * Correlation ID and Agent ID are extracted from headers.
 */

import { generateCorrelationId, type PinoLogger } from "@aesir/platform";
import type { MCPToolContext } from "@aesir/types";
import type { Block, KnownBlock } from "@slack/web-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import rateLimit from "express-rate-limit";
import { createSlackClientFromDatabase } from "../client/factory.js";
import type { SlackCredentialStore } from "../db/credential-store.js";
import {
  GetMessageInputSchema,
  ListChannelsInputSchema,
  MessageOutputSchema,
  ReplyToThreadInputSchema,
  SendApprovalRequestInputSchema,
  SendEscalationRequestInputSchema,
  SendMessageInputSchema,
  UpdateMessageInputSchema,
  UpdateMessageOutputSchema,
} from "../mcp/schemas.js";
import {
  sendApprovalRequest,
  sendEscalationRequest,
  sendMessage,
} from "../messages/sender.js";
import type { ApprovalNotification } from "../messages/types.js";

export interface CreateMCPRouterOptions {
  db: NodePgDatabase;
  credentialStore: SlackCredentialStore;
  logger: PinoLogger;
  teamId?: string;
}

// Tool metadata for /mcp/tools listing
const TOOL_DEFINITIONS = [
  {
    name: "send_message",
    description:
      "Send a message to a Slack channel or direct message. Supports plain text and Block Kit formatting.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID or name (e.g., 'C1234567890' or '#general')",
        },
        text: { type: "string", description: "Message text" },
        blocks: {
          type: "array",
          description: "Optional Block Kit blocks for rich formatting",
        },
        threadTs: {
          type: "string",
          description: "Optional thread timestamp to reply in thread",
        },
      },
      required: ["channel", "text"],
    },
  },
  {
    name: "send_approval_request",
    description:
      "Send an approval request message with approve/reject buttons. Used for PR reviews and task approvals.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID" },
        taskId: { type: "string", description: "Task identifier" },
        title: { type: "string", description: "Approval title" },
        summary: {
          type: "string",
          description: "Summary of what needs approval",
        },
        prUrl: { type: "string", description: "Pull request URL" },
        actionPrefix: {
          type: "string",
          description: "Action ID prefix (default: 'approve')",
        },
      },
      required: ["channel", "taskId", "title", "summary"],
    },
  },
  {
    name: "send_escalation_request",
    description:
      "Send an escalation request message with retry/abort buttons. Used when agent needs human help.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID" },
        taskId: { type: "string", description: "Task identifier" },
        title: { type: "string", description: "Escalation title" },
        errorDetails: {
          type: "string",
          description: "Details about the error or issue",
        },
        actionPrefix: {
          type: "string",
          description: "Action ID prefix for buttons",
        },
      },
      required: ["channel", "taskId", "title", "errorDetails", "actionPrefix"],
    },
  },
  {
    name: "get_message",
    description:
      "Retrieve a message by timestamp. Returns message content, author, and thread information.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID" },
        ts: { type: "string", description: "Message timestamp" },
      },
      required: ["channel", "ts"],
    },
  },
  {
    name: "reply_to_thread",
    description:
      "Reply to a specific thread. Creates a threaded reply in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID" },
        threadTs: { type: "string", description: "Thread timestamp" },
        text: { type: "string", description: "Reply text" },
        blocks: {
          type: "array",
          description: "Optional Block Kit blocks for rich formatting",
        },
      },
      required: ["channel", "threadTs", "text"],
    },
  },
  {
    name: "update_message",
    description:
      "Update an existing Slack message. Can change text and/or blocks. At least one of text or blocks must be provided.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID where the message exists",
        },
        ts: {
          type: "string",
          description: "Message timestamp to update (unique message ID)",
        },
        text: {
          type: "string",
          description: "New text content (required if blocks not provided)",
        },
        blocks: {
          type: "array",
          description: "New Block Kit blocks (required if text not provided)",
        },
      },
      required: ["channel", "ts"],
    },
  },
  {
    name: "list_channels",
    description:
      "List available Slack channels. Returns channel names, IDs, and metadata. Use to discover channels before sending messages.",
    inputSchema: {
      type: "object",
      properties: {
        types: {
          type: "string",
          description:
            "Comma-separated list of channel types (public_channel, private_channel, im, mpim)",
        },
        limit: {
          type: "number",
          description: "Maximum number of channels to return (default: 100)",
        },
        excludeArchived: {
          type: "boolean",
          description: "Exclude archived channels (default: true)",
        },
      },
    },
  },
];

/**
 * Create Express router for MCP endpoints
 */
export function createMCPRouter(options: CreateMCPRouterOptions): Router {
  const { db: _db, credentialStore, logger, teamId = "default" } = options;

  const router = createRouter();

  const childLogger = logger.child({
    component: "integrations:slack:api:mcp",
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
  router.use(mcpRateLimiter as unknown as RequestHandler);

  /**
   * List available MCP tools
   * GET /mcp/tools
   */
  router.get("/mcp/tools", async (req: Request, res: Response) => {
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
   * POST /mcp/tools/:name
   *
   * Headers:
   * - X-Correlation-ID: Optional correlation ID for tracing
   * - X-Agent-ID: Required agent identifier for permission checks
   *
   * Body: Tool arguments as JSON
   */
  router.post(
    "/mcp/tools/:name",
    async (req: Request, res: Response): Promise<void> => {
      const { name } = req.params;
      const correlationId =
        (req.headers["x-correlation-id"] as string) ||
        generateCorrelationId("tool");
      const agentId = req.headers["x-agent-id"] as string;
      const startTime = Date.now();

      const requestLogger = childLogger.child({
        correlationId,
        toolName: name,
        agentId,
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

      // Create Slack client
      let client: Awaited<ReturnType<typeof createSlackClientFromDatabase>>;
      try {
        client = await createSlackClientFromDatabase({
          teamId,
          credentialStore,
          logger: requestLogger,
        });
      } catch (error) {
        requestLogger.error(
          { err: error, teamId },
          "Failed to create Slack client",
        );
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create Slack client";
        res.status(500).json({
          error: message,
          isError: true,
          meta: {
            correlation_id: correlationId,
            duration_ms: Date.now() - startTime,
          },
        });
        return;
      }

      try {
        const _context: MCPToolContext = {
          logger: requestLogger,
          correlationId,
          agentId,
          startTime,
        };

        const args = req.body;

        // Route to appropriate handler
        let responseData: {
          content: Array<{ type: "text"; text: string }>;
          data?: unknown;
        };
        const isError = false;

        switch (name) {
          case "send_message": {
            const validation = SendMessageInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid send_message input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
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

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Message sent successfully to ${output.channel}`,
                },
              ],
              data: output,
            };
            break;
          }

          case "send_approval_request": {
            const validation = SendApprovalRequestInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid send_approval_request input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
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

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Approval request sent to ${approvalResult.channel}`,
                },
              ],
              data: {
                ts: approvalResult.ts,
                channel: approvalResult.channel,
              },
            };
            break;
          }

          case "send_escalation_request": {
            const validation = SendEscalationRequestInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid send_escalation_request input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const input = validation.data;
            const escalationOptions = {
              taskId: input.taskId,
              title: input.title,
              errorDetails: input.errorDetails,
              actionPrefix: input.actionPrefix,
            };

            const escalationResult = await sendEscalationRequest(
              client,
              escalationOptions,
              input.channel,
            );

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Escalation request sent to ${escalationResult.channel}`,
                },
              ],
              data: {
                ts: escalationResult.ts,
                channel: escalationResult.channel,
                actionIds: {
                  retry: `${input.actionPrefix}_retry`,
                  abort: `${input.actionPrefix}_abort`,
                },
              },
            };
            break;
          }

          case "get_message": {
            const validation = GetMessageInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid get_message input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const input = validation.data;
            const historyResult = await client.conversations.history({
              channel: input.channel,
              latest: input.ts,
              inclusive: true,
              limit: 1,
            });

            if (
              !historyResult.messages ||
              historyResult.messages.length === 0
            ) {
              requestLogger.warn(
                { channel: input.channel, ts: input.ts },
                "Message not found",
              );
              res.status(404).json({
                error: "Message not found",
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const message = historyResult.messages[0];

            if (!message) {
              requestLogger.warn(
                { channel: input.channel, ts: input.ts },
                "Message not found",
              );
              res.status(404).json({
                error: "Message not found",
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Retrieved message from ${input.channel}: ${message.text || ""}`,
                },
              ],
              data: {
                ts: message.ts || input.ts,
                text: message.text || "",
                user: message.user,
                threadTs: message.thread_ts,
                replyCount: message.reply_count,
              },
            };
            break;
          }

          case "reply_to_thread": {
            const validation = ReplyToThreadInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid reply_to_thread input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
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

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Reply sent to thread ${input.threadTs}`,
                },
              ],
              data: {
                ts: replyResult.ts,
                channel: replyResult.channel,
              },
            };
            break;
          }

          case "update_message": {
            const validation = UpdateMessageInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid update_message input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const input = validation.data;

            // Slack requires at least one of text or blocks
            if (!input.text && !input.blocks) {
              requestLogger.warn("update_message requires text or blocks");
              res.status(400).json({
                error:
                  "Invalid input: at least one of text or blocks must be provided",
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            // Build update options - ChatUpdateArguments requires text or blocks
            // We validated above that at least one is present
            const updateResult = await client.chat.update({
              channel: input.channel,
              ts: input.ts,
              text: input.text ?? "",
              ...(input.blocks !== undefined && {
                blocks: input.blocks as (Block | KnownBlock)[],
              }),
            });

            const updateOutput = UpdateMessageOutputSchema.parse({
              ts: updateResult.ts,
              channel: updateResult.channel,
            });

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Message updated in ${updateOutput.channel}`,
                },
              ],
              data: updateOutput,
            };
            break;
          }

          case "list_channels": {
            const validation = ListChannelsInputSchema.safeParse(args);
            if (!validation.success) {
              requestLogger.warn(
                { error: validation.error.message },
                "Invalid list_channels input",
              );
              res.status(400).json({
                error: `Invalid input: ${validation.error.message}`,
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const input = validation.data;
            const channelsResult = await client.conversations.list({
              types: input.types,
              limit: input.limit,
              exclude_archived: input.excludeArchived,
            });

            if (!channelsResult.channels) {
              requestLogger.warn("No channels returned from API");
              res.status(500).json({
                error: "No channels returned from API",
                isError: true,
                meta: { correlation_id: correlationId },
              });
              return;
            }

            const channels = channelsResult.channels.map((channel) => ({
              id: channel.id,
              name: channel.name,
              isPrivate: channel.is_private || false,
              memberCount: channel.num_members,
              topic: channel.topic?.value,
            }));

            responseData = {
              content: [
                {
                  type: "text" as const,
                  text: `Found ${channels.length} channels: ${channels.map((c) => c.name).join(", ")}`,
                },
              ],
              data: { channels },
            };
            break;
          }

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
          { durationMs, success: !isError },
          "MCP tool invocation completed",
        );

        res.json({
          ...responseData,
          isError,
          meta: {
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
