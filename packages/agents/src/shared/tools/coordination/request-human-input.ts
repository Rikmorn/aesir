/**
 * Request Human Input Tool
 *
 * Coordination tool that returns a sentinel ToolResult with structured JSON.
 * The conversation executor parses this marker to pause the conversation and
 * await human input via Slack.
 *
 * This is a pure tool -- no external dependencies needed. It does NOT modify
 * the agent loop; instead, it uses a sentinel return value that the executor
 * recognizes.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";

// ---------------------------------------------------------------------------
// Sentinel Marker
// ---------------------------------------------------------------------------

/** Sentinel marker for parsing in conversation executor */
export const HUMAN_INPUT_MARKER = "human_input_requested" as const;

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const requestHumanInputSchema = z.object({
  channel: z
    .string()
    .describe("Slack channel ID to send the request to (e.g., 'C1234567890')"),
  message: z
    .string()
    .describe("Message to send to the human explaining what input is needed"),
  requestType: z
    .enum(["approval", "clarification", "escalation"])
    .describe("Type of human input being requested"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the request_human_input tool.
 *
 * Returns a sentinel JSON result that the conversation executor can parse
 * to pause the conversation. The tool instructs the LLM to stop after calling it.
 *
 * @returns ToolDefinition for the request_human_input tool
 */
export function createRequestHumanInputTool(): ToolDefinition {
  return {
    name: "request_human_input",
    description:
      "Pause execution and wait for human input. This tool does NOT send any Slack message -- you must " +
      "send the notification FIRST using slack_send_approval_request or slack_send_message, then call " +
      "this tool to pause. IMPORTANT: After calling this tool, you MUST immediately end your turn " +
      "and provide a summary of your current state. Do NOT call any other tools after request_human_input.",
    inputSchema: requestHumanInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = requestHumanInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      return {
        content: JSON.stringify({
          type: HUMAN_INPUT_MARKER,
          channel: parsed.data.channel,
          message: parsed.data.message,
          requestType: parsed.data.requestType,
        }),
      };
    },
  };
}
