/**
 * Product Agent Runner
 *
 * Connects Slack message events to the LangGraph conversation graph.
 * Handles state management via checkpointer with thread_ts as thread_id.
 *
 * Key design decisions:
 * - Uses threadTs for checkpointer thread_id (enables conversation persistence)
 * - Converts conversation history to LangChain message format
 * - Returns structured output with response, phase, and created tasks
 */

import { createLogger } from "@aesir/common";
import type { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { LinearClient } from "@linear/sdk";
import { createProductAgentGraph } from "./graph.js";
import type { CreatedTask, ProductAgentPhase } from "./state.js";

const logger = createLogger({
  defaultContext: { module: "product-agent-runner" },
});

/**
 * Input for running the Product Agent
 */
export interface RunProductAgentInput {
  /** User's message text */
  message: string;
  /** Slack context for response routing */
  slackContext: {
    channelId: string;
    threadTs: string;
    userId: string;
  };
  /** Previous conversation messages (from Slack thread) */
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * Output from the Product Agent
 */
export interface RunProductAgentOutput {
  /** Response text to send back to user */
  response: string;
  /** Current conversation phase */
  phase: ProductAgentPhase;
  /** Tasks created in Linear (if any) */
  createdTasks?: Array<{ id: string; identifier: string; title: string }>;
}

/**
 * Options for running the Product Agent
 */
export interface RunProductAgentOptions {
  /** LLM instance for the graph nodes */
  llm: ChatAnthropic;
  /** LinearClient for creating issues */
  linearClient: LinearClient;
  /** Team ID for issue creation */
  teamId: string;
  /** Checkpointer for conversation persistence */
  checkpointer: PostgresSaver;
}

/**
 * Run the Product Agent with a message
 *
 * Invokes the conversation graph with the user's message,
 * handling checkpointing and state restoration automatically.
 *
 * @param input - Message and context from Slack
 * @param options - Dependencies for the graph
 * @returns Agent response with phase and created tasks
 *
 * @example
 * ```typescript
 * const result = await runProductAgent(
 *   {
 *     message: "I want to build a feature for exporting data as CSV",
 *     slackContext: { channelId: "C123", threadTs: "1234.5678", userId: "U123" },
 *   },
 *   {
 *     llm: new ChatAnthropic({ model: 'claude-sonnet-4-20250514' }),
 *     linearClient,
 *     teamId: "team-123",
 *     checkpointer,
 *   }
 * );
 *
 * console.log(result.response); // Agent's response
 * console.log(result.phase);    // Current phase
 * console.log(result.createdTasks); // Any created tasks
 * ```
 */
export async function runProductAgent(
  input: RunProductAgentInput,
  options: RunProductAgentOptions,
): Promise<RunProductAgentOutput> {
  const runLogger = logger.child({
    threadId: input.slackContext.threadTs,
    userId: input.slackContext.userId,
  });

  runLogger.info("run_product_agent_start", {
    message: "Starting Product Agent run",
    context: {
      messageLength: input.message.length,
      historyCount: input.conversationHistory?.length ?? 0,
    },
  });

  try {
    // Create the graph with injected dependencies
    const graph = createProductAgentGraph({
      llm: options.llm,
      linearClient: options.linearClient,
      teamId: options.teamId,
      checkpointer: options.checkpointer,
    });

    // Use threadTs as thread_id for checkpointer
    // This enables conversation state to persist across messages
    const config = {
      configurable: { thread_id: input.slackContext.threadTs },
    };

    // Build messages array from conversation history + current message
    const messages = [
      ...(input.conversationHistory ?? []).map((m) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content),
      ),
      new HumanMessage(input.message),
    ];

    // Invoke the graph
    const result = await graph.invoke(
      {
        messages,
        slackContext: input.slackContext,
      },
      config,
    );

    // Extract the last AI message as the response
    const lastMessage = result.messages[result.messages.length - 1];
    let response: string;
    if (lastMessage) {
      response =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
    } else {
      response = "I'm processing your request. Please wait...";
    }

    // Build output with optional created tasks
    const output: RunProductAgentOutput = {
      response,
      phase: result.phase,
    };

    // Include created tasks if any exist
    if (result.createdTasks && result.createdTasks.length > 0) {
      output.createdTasks = result.createdTasks.map((task: CreatedTask) => ({
        id: task.id,
        identifier: task.identifier,
        title: task.title,
      }));
    }

    runLogger.info("run_product_agent_complete", {
      outcome: "success",
      message: "Product Agent run completed",
      context: {
        phase: result.phase,
        responseLength: response.length,
        tasksCreated: output.createdTasks?.length ?? 0,
      },
    });

    return output;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    runLogger.error("run_product_agent_error", {
      outcome: "failure",
      message: `Product Agent run failed: ${errorMessage}`,
    });

    throw error;
  }
}
