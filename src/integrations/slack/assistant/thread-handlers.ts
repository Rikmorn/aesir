/**
 * Slack Thread Event Handlers
 *
 * Handles app_mention and direct message events from Slack,
 * routes them to the Product Agent graph, and posts responses.
 *
 * Key design decisions:
 * - Uses thread_ts for conversation continuity
 * - Checkpointer with thread_ts as thread_id enables state persistence
 * - Formats responses for Slack (Block Kit sections)
 * - Handles errors gracefully with user-friendly error messages
 */

import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { AppMentionEvent, GenericMessageEvent } from "@slack/types";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { LinearClient } from "@linear/sdk";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createLogger } from "../../../logging/logger.js";
import { runProductAgent, type RunProductAgentInput } from "../../../agents/product-agent/runner.js";

const logger = createLogger({ defaultContext: { module: "slack-thread-handlers" } });

/**
 * Options for thread handler functions
 */
export interface ThreadHandlerOptions {
  /** LLM instance for the Product Agent */
  llm: ChatAnthropic;
  /** LinearClient for creating issues */
  linearClient: LinearClient;
  /** Team ID for issue creation */
  teamId: string;
  /** Checkpointer for conversation persistence */
  checkpointer: SqliteSaver;
}

/**
 * Extract conversation history from a Slack thread
 *
 * Converts Slack messages to the format expected by the Product Agent.
 *
 * @param client - Slack WebClient
 * @param channelId - Channel ID
 * @param threadTs - Thread timestamp
 * @returns Array of conversation messages
 */
async function getConversationHistory(
  client: WebClient,
  channelId: string,
  threadTs: string
): Promise<Array<{ role: string; content: string }>> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 50, // Get recent context
    });

    if (!result.messages) {
      return [];
    }

    // Convert Slack messages to conversation format
    // Skip the last message (current message we're processing)
    return result.messages.slice(0, -1).map((msg) => ({
      role: msg.bot_id ? "assistant" : "user",
      content: msg.text ?? "",
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.warn("conversation_history_fetch_failed", {
      message: `Failed to fetch conversation history: ${errorMessage}`,
      context: { channelId, threadTs },
    });
    return [];
  }
}

/**
 * Strip bot mention from message text
 *
 * Removes <@BOTID> patterns from the beginning of the message.
 *
 * @param text - Raw message text
 * @returns Cleaned message text
 */
function stripBotMention(text: string): string {
  // Remove bot mention at start: <@U1234> or <@U1234|botname>
  return text.replace(/^<@[A-Z0-9]+(\|[^>]+)?>\s*/i, "").trim();
}

/**
 * Format response for Slack with Block Kit
 *
 * Creates a visually formatted message with task creation confirmation.
 *
 * @param response - Text response
 * @param createdTasks - Optional list of created tasks
 * @returns Slack blocks array
 */
function formatSlackResponse(
  response: string,
  createdTasks?: Array<{ identifier: string; title: string }>
): Array<{ type: string; text?: { type: string; text: string } }> {
  const blocks: Array<{ type: string; text?: { type: string; text: string } }> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: response,
      },
    },
  ];

  // Add task creation confirmation if tasks were created
  if (createdTasks && createdTasks.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Created Tasks:*\n" +
          createdTasks
            .map((task) => `- \`${task.identifier}\`: ${task.title}`)
            .join("\n"),
      },
    });
  }

  return blocks;
}

/**
 * Process a message through the Product Agent
 *
 * Common logic for both app_mention and DM handlers.
 *
 * @param client - Slack WebClient
 * @param channelId - Channel ID
 * @param threadTs - Thread timestamp
 * @param userId - User ID
 * @param messageText - Message text (already cleaned)
 * @param options - Handler options with dependencies
 * @returns Result from Product Agent
 */
async function processMessage(
  client: WebClient,
  channelId: string,
  threadTs: string,
  userId: string,
  messageText: string,
  options: ThreadHandlerOptions
) {
  const { llm, linearClient, teamId, checkpointer } = options;

  // Get conversation history if in a thread
  const conversationHistory = await getConversationHistory(client, channelId, threadTs);

  // Build input for Product Agent
  const input: RunProductAgentInput = {
    message: messageText,
    slackContext: {
      channelId,
      threadTs,
      userId,
    },
    conversationHistory,
  };

  // Run the Product Agent
  return runProductAgent(input, {
    llm,
    linearClient,
    teamId,
    checkpointer,
  });
}

/**
 * Create handler for app_mention events
 *
 * Called when the bot is @mentioned in a channel.
 * Processes the message through the Product Agent and responds in thread.
 *
 * @param options - Handler options with dependencies
 * @returns Bolt event handler function
 */
export function handleAppMention(options: ThreadHandlerOptions) {
  return async ({
    event,
    client,
    say,
  }: {
    event: AppMentionEvent;
    client: WebClient;
    say: (message: string | { text: string; thread_ts?: string; blocks?: unknown[] }) => Promise<unknown>;
  }): Promise<void> => {
    const handlerLogger = logger.child({ handler: "app_mention" });

    const channelId = event.channel;
    const threadTs = event.thread_ts ?? event.ts;
    const userId = event.user ?? "unknown";
    const rawText = event.text ?? "";

    handlerLogger.info("app_mention_received", {
      message: "Received app mention",
      context: { channelId, threadTs, userId },
    });

    try {
      // Skip if no user (bot messages or system messages)
      if (!event.user) {
        handlerLogger.debug("app_mention_no_user", {
          message: "Ignoring app mention without user",
        });
        return;
      }

      // Clean the message text (remove bot mention)
      const messageText = stripBotMention(rawText);

      if (!messageText) {
        await say({
          text: "Hi! How can I help you today? Tell me about a feature you'd like to build.",
          thread_ts: threadTs,
        });
        return;
      }

      // Process through Product Agent
      const result = await processMessage(
        client,
        channelId,
        threadTs,
        event.user,
        messageText,
        options
      );

      // Format and send response
      const blocks = formatSlackResponse(result.response, result.createdTasks);

      await client.chat.postMessage({
        channel: channelId,
        text: result.response,
        thread_ts: threadTs,
        blocks,
      });

      handlerLogger.info("app_mention_handled", {
        outcome: "success",
        message: "Processed app mention and sent response",
        context: {
          phase: result.phase,
          tasksCreated: result.createdTasks?.length ?? 0,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      handlerLogger.error("app_mention_error", {
        outcome: "failure",
        message: `Error processing app mention: ${errorMessage}`,
        context: { channelId, threadTs },
      });

      // Send user-friendly error message
      await say({
        text: "Sorry, I encountered an error processing your request. Please try again.",
        thread_ts: threadTs,
      });
    }
  };
}

/**
 * Create handler for direct message events
 *
 * Called when the bot receives a DM.
 * Similar to app_mention but for direct conversations.
 * Uses the message ts as thread_ts for conversation continuity.
 *
 * @param options - Handler options with dependencies
 * @returns Bolt event handler function
 */
export function handleDirectMessage(options: ThreadHandlerOptions) {
  return async ({
    event,
    client,
    say,
  }: {
    event: GenericMessageEvent;
    client: WebClient;
    say: (message: string | { text: string; thread_ts?: string; blocks?: unknown[] }) => Promise<unknown>;
  }): Promise<void> => {
    const handlerLogger = logger.child({ handler: "direct_message" });

    const channelId = event.channel;
    // Use thread_ts if in thread, otherwise use message ts to start thread
    const threadTs = event.thread_ts ?? event.ts;
    const userId = event.user;
    const messageText = event.text ?? "";

    // Skip if no user (shouldn't happen but be safe)
    if (!userId) {
      return;
    }

    handlerLogger.info("direct_message_received", {
      message: "Received direct message",
      context: { channelId, threadTs, userId },
    });

    try {
      if (!messageText.trim()) {
        await say({
          text: "Hi! How can I help you today? Tell me about a feature you'd like to build.",
          thread_ts: threadTs,
        });
        return;
      }

      // Process through Product Agent
      const result = await processMessage(
        client,
        channelId,
        threadTs,
        userId,
        messageText,
        options
      );

      // Format and send response
      const blocks = formatSlackResponse(result.response, result.createdTasks);

      await client.chat.postMessage({
        channel: channelId,
        text: result.response,
        thread_ts: threadTs,
        blocks,
      });

      handlerLogger.info("direct_message_handled", {
        outcome: "success",
        message: "Processed direct message and sent response",
        context: {
          phase: result.phase,
          tasksCreated: result.createdTasks?.length ?? 0,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      handlerLogger.error("direct_message_error", {
        outcome: "failure",
        message: `Error processing direct message: ${errorMessage}`,
        context: { channelId, threadTs },
      });

      // Send user-friendly error message
      await say({
        text: "Sorry, I encountered an error processing your request. Please try again.",
        thread_ts: threadTs,
      });
    }
  };
}

/**
 * Register Product Agent handlers with a Bolt app
 *
 * Sets up event handlers for app_mention and direct messages.
 * Both handlers route to the Product Agent for requirement gathering.
 *
 * @param app - Bolt App instance
 * @param options - Handler options with dependencies
 *
 * @example
 * ```typescript
 * import { createBoltApp, registerHandlers } from './integrations/slack';
 *
 * const app = createBoltApp(config);
 *
 * registerHandlers(app, {
 *   llm: new ChatAnthropic({ model: 'claude-sonnet-4-20250514' }),
 *   linearClient: getLinearClient(token),
 *   teamId: 'team-123',
 *   checkpointer: SqliteSaver.fromConnString(':memory:'),
 * });
 *
 * await startBoltApp(app);
 * ```
 */
export function registerHandlers(app: App, options: ThreadHandlerOptions): void {
  logger.info("register_handlers", {
    message: "Registering Product Agent event handlers",
  });

  // Handle @mentions in channels
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event("app_mention", handleAppMention(options) as any);

  // Handle direct messages
  // Note: Bolt's message handler fires for all message events
  // We filter to only handle DMs (channel_type === 'im')
  app.event("message", async (args) => {
    const { event, client, say } = args;
    // Type guard for message events with channel_type 'im'
    if ("channel_type" in event && event.channel_type === "im") {
      // Ignore bot messages to prevent loops
      if ("bot_id" in event && event.bot_id) {
        return;
      }
      // Ignore message subtypes (edits, deletes, etc.)
      if ("subtype" in event && event.subtype) {
        return;
      }
      await handleDirectMessage(options)({
        event: event as GenericMessageEvent,
        client,
        say,
      });
    }
  });

  logger.info("handlers_registered", {
    outcome: "success",
    message: "Product Agent event handlers registered",
  });
}
