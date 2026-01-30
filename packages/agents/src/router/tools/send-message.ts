/**
 * Send Message Tool
 *
 * Router tool that sends a Slack message via the MCP layer.
 * Used by the LLM for clarification requests or error notifications
 * when routing fails or additional context is needed.
 */

import { z } from "zod";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import { callMcpTool } from "../../shared/mcp/client.js";
import { McpError } from "../../shared/mcp/errors.js";
import type { RouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const SendMessageInputSchema = z.object({
  channel: z.string().describe("Slack channel ID to send message to"),
  text: z.string().describe("Message text to send"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the send_message tool definition.
 *
 * Sends a Slack message via the MCP layer using callMcpTool.
 * Uses agentId "router" for MCP permission checks.
 *
 * @param _deps - Router dependencies (logger used for context)
 * @returns ToolDefinition for the agent loop
 */
export function createSendMessageTool(_deps: RouterDeps): ToolDefinition {
  return {
    name: "send_message",
    description:
      "Send a Slack message. Use for clarification requests or error notifications when routing fails.",
    inputSchema: SendMessageInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = SendMessageInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { channel, text } = parsed.data;

      try {
        await callMcpTool({
          integration: "slack",
          tool: "send_message",
          params: { channel, text },
          agentId: "router",
          correlationId: "router",
        });

        return {
          content: JSON.stringify({ sent: true, channel }),
        };
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: `send_message error: ${error.message}`,
            isError: true,
          };
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: `send_message error: ${message}`,
          isError: true,
        };
      }
    },
  };
}
