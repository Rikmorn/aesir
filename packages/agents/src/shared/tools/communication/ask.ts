/**
 * communication:ask Tool Factory
 *
 * Asks a question on the originating channel, optionally with structured options.
 * Options are rendered as text instructions before being sent via the denormalizer.
 * Requires replyContext from the signal that resumed the conversation.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { denormalize } from "../../communication/denormalizer.js";
import {
  type CommunicationToolDeps,
  ReplyContextSchema,
} from "../../communication/types.js";
import { McpError } from "../../mcp/errors.js";

const AskOptionSchema = z.object({
  label: z.string().describe("Display label for this option"),
  value: z.string().describe("Value sent back when this option is selected"),
});

const AskInputSchema = z.object({
  replyContext: ReplyContextSchema.describe(
    "Channel address to send the question to",
  ),
  question: z.string().describe("Question text to ask"),
  options: z
    .array(AskOptionSchema)
    .optional()
    .describe("Structured options for the recipient to choose from"),
});

/**
 * Render structured options as text instructions.
 */
function renderOptions(
  options: Array<{ label: string; value: string }>,
): string {
  return options
    .map((opt) => `- **${opt.label}**: reply "${opt.value}"`)
    .join("\n");
}

/**
 * Create a communication:ask tool that sends questions via the denormalizer.
 *
 * @param deps - Communication dependencies (agentId, correlationId, logger)
 * @returns ToolDefinition compatible with the agent loop
 */
export function createAskTool(deps: CommunicationToolDeps): ToolDefinition {
  return {
    name: "communication_ask",
    description:
      "Ask a question on the originating channel, optionally with structured options. " +
      "Options are rendered as text instructions. Requires replyContext.",
    inputSchema: AskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = AskInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { question, options, replyContext } = parsed.data;

      // Compose text: question + rendered options (if present)
      const text =
        options && options.length > 0
          ? `${question}\n\n${renderOptions(options)}`
          : question;

      try {
        const result = await denormalize({ replyContext, text }, deps);
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: `communication_ask error: ${error.message}`,
            isError: true,
          };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: `communication_ask error: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
