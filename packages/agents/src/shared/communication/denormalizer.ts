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
 * Communication intent types for activity mapping.
 *
 * When targeting a Linear agent session, intent determines the activity type:
 * - reply -> response
 * - ask -> elicitation
 * - notify_reasoning -> thought
 * - notify_action -> action
 */
export type CommunicationIntent =
  | "reply"
  | "ask"
  | "notify_reasoning"
  | "notify_action";

/**
 * Parameters for the denormalize dispatch function.
 */
export interface DenormalizeParams {
  replyContext: ReplyContext;
  text: string;
  /** Communication intent -- used to determine activity type for agent sessions */
  intent?: CommunicationIntent;
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
      if (replyContext.agentSessionId) {
        // Agent session active: use typed activity via Agent SDK
        const activityType = resolveActivityType(params.intent);

        if (params.intent === "notify_action") {
          // Action activities use action + parameter fields (not body).
          // Split text into action verb + parameter on first space.
          // If text has no space (single word), fall back to thought type
          // since action type requires both fields to be non-empty.
          const spaceIdx = text.indexOf(" ");
          if (spaceIdx > 0) {
            return callMcpTool({
              integration: "linear",
              tool: "create_agent_activity",
              params: {
                agentSessionId: replyContext.agentSessionId,
                type: activityType,
                action: text.slice(0, spaceIdx),
                parameter: text.slice(spaceIdx + 1),
              },
              ...mcpBase,
            });
          }
          // No meaningful split possible — fall back to thought
          return callMcpTool({
            integration: "linear",
            tool: "create_agent_activity",
            params: {
              agentSessionId: replyContext.agentSessionId,
              type: "thought",
              body: text,
            },
            ...mcpBase,
          });
        }

        return callMcpTool({
          integration: "linear",
          tool: "create_agent_activity",
          params: {
            agentSessionId: replyContext.agentSessionId,
            type: activityType,
            body: text,
          },
          ...mcpBase,
        });
      }
      // No session: fall back to comment (product-agent path)
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
      return replyContext.agentSessionId
        ? "create_agent_activity"
        : "create_comment";
    case "github":
      return "create_pr_comment";
  }
}

/**
 * Map communication intent to Linear activity type.
 *
 * Intent-to-activity mapping (locked decisions):
 * - reply -> response
 * - ask -> elicitation
 * - notify_reasoning -> thought
 * - notify_action -> action
 * - default (undefined) -> response (backward compat)
 */
function resolveActivityType(intent?: CommunicationIntent): string {
  switch (intent) {
    case "reply":
      return "response";
    case "ask":
      return "elicitation";
    case "notify_reasoning":
      return "thought";
    case "notify_action":
      return "action";
    default:
      return "response";
  }
}
