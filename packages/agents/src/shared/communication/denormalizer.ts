/**
 * Outbound Denormalizer
 *
 * Pure dispatch function that routes domain-language text to the correct
 * integration MCP tool based on replyContext channel type.
 *
 * The denormalizer is intentionally "boring" -- a thin switch statement
 * connecting ReplyContext to callMcpTool. No retry logic (callMcpTool
 * handles retries), no error wrapping (MCP errors propagate as-is),
 * no state, no recovery.
 */

import { callMcpTool } from "../mcp/client.js";
import type { CommunicationToolDeps, ReplyContext } from "./types.js";

/**
 * Parameters for the denormalize dispatch function.
 */
export interface DenormalizeParams {
  replyContext: ReplyContext;
  text: string;
}

/**
 * Dispatch an outbound message to the correct integration MCP tool.
 *
 * Routes based on `replyContext.channel`:
 * - `slack` + threadTs -> `slack:reply_to_thread`
 * - `slack` without threadTs -> `slack:send_message`
 * - `linear` -> `linear:create_comment`
 * - `github` -> `github:create_pr_comment`
 *
 * @returns The raw callMcpTool result (no wrapping)
 * @throws McpError if the integration call fails (propagated as-is)
 */
export async function denormalize(
  params: DenormalizeParams,
  deps: CommunicationToolDeps,
): Promise<unknown> {
  const { replyContext, text } = params;

  // Determine MCP tool name for logging before dispatch
  const tool = resolveToolName(replyContext);

  deps.logger.info(
    { channel: replyContext.channel, tool, agentId: deps.agentId },
    "Denormalizing outbound message",
  );

  // Build common MCP call fields
  const mcpBase = {
    agentId: deps.agentId,
    correlationId: deps.correlationId,
    ...(deps.taskId && { taskId: deps.taskId }),
  };

  switch (replyContext.channel) {
    case "slack": {
      if (replyContext.threadTs) {
        return callMcpTool({
          integration: "slack",
          tool: "reply_to_thread",
          params: {
            channel: replyContext.channelId,
            threadTs: replyContext.threadTs,
            text,
          },
          ...mcpBase,
        });
      }
      return callMcpTool({
        integration: "slack",
        tool: "send_message",
        params: {
          channel: replyContext.channelId,
          text,
        },
        ...mcpBase,
      });
    }

    case "linear": {
      return callMcpTool({
        integration: "linear",
        tool: "create_comment",
        params: {
          issueId: replyContext.issueId,
          body: text,
        },
        ...mcpBase,
      });
    }

    case "github": {
      return callMcpTool({
        integration: "github",
        tool: "create_pr_comment",
        params: {
          owner: replyContext.owner,
          repo: replyContext.repo,
          prNumber: replyContext.prNumber,
          body: text,
          ...(replyContext.commentId && { inReplyTo: replyContext.commentId }),
        },
        ...mcpBase,
      });
    }
  }
  // No default: TypeScript exhaustive checking on discriminated union
}

/**
 * Resolve the MCP tool name for a given replyContext.
 * Used for logging before dispatch.
 */
function resolveToolName(replyContext: ReplyContext): string {
  switch (replyContext.channel) {
    case "slack":
      return replyContext.threadTs ? "reply_to_thread" : "send_message";
    case "linear":
      return "create_comment";
    case "github":
      return "create_pr_comment";
  }
}
