/**
 * Slack MCP Tools - Channels
 *
 * Provides MCP tools for channel operations:
 * - list_channels: List available channels
 */

import {
  createErrorResult,
  createToolResult,
  type MCPToolContext,
  type PinoLogger,
} from "@aesir/common";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createSlackClientFromDatabase } from "../../client/factory.js";
import { createSlackCredentialStore } from "../../db/credential-store.js";
import { checkSlackToolPermission } from "../../db/permissions.js";
import {
  ChannelSchema,
  ListChannelsInputSchema,
  type ListChannelsOutput,
} from "../schemas.js";

export interface RegisterChannelToolsDeps {
  server: Server;
  db: NodePgDatabase;
  logger: PinoLogger;
  teamId: string;
}

/**
 * Register channel-related tools on the MCP server
 */
export function registerChannelTools(deps: RegisterChannelToolsDeps): void {
  const { server, db, logger, teamId } = deps;

  // Create credential store once for all tools
  const credentialStore = createSlackCredentialStore({ db, logger });

  // === LIST_CHANNELS ===

  // @ts-expect-error MCP SDK type mismatch - setRequestHandler expects different signature
  server.setRequestHandler("tools/list", async () => {
    return {
      tools: [
        {
          name: "list_channels",
          description:
            "List available Slack channels. Returns channel names, IDs, and metadata. Use to discover channels before sending messages.",
          inputSchema: zodToJsonSchema(ListChannelsInputSchema),
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
      if (toolName === "list_channels") {
        const validation = ListChannelsInputSchema.safeParse(args);
        if (!validation.success) {
          return createErrorResult(
            context,
            `Invalid input: ${validation.error.message}`,
          );
        }

        const input = validation.data;
        const result = await client.conversations.list({
          types: input.types,
          limit: input.limit,
          exclude_archived: input.excludeArchived,
        });

        if (!result.channels) {
          return createErrorResult(context, "No channels returned from API");
        }

        const channels = result.channels.map((channel) => {
          return ChannelSchema.parse({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.is_private || false,
            memberCount: channel.num_members,
            topic: channel.topic?.value,
          });
        });

        const output: ListChannelsOutput = { channels };

        return createToolResult(
          context,
          `Found ${channels.length} channels`,
          output,
        );
      }

      return createErrorResult(context, `Unknown tool: ${toolName}`);
    } catch (error) {
      context.logger.error({ err: error, toolName }, "Tool execution failed");

      const message =
        error instanceof Error ? error.message : "Unknown error occurred";

      return createErrorResult(context, `Tool execution failed: ${message}`);
    }
  });
}
