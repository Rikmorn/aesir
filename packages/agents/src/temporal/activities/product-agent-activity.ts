/**
 * Product Agent Temporal Activity
 *
 * Wraps the LangGraph product agent as a Temporal activity.
 * Uses PostgreSQL checkpointer for conversation history persistence.
 * Thread ID from Slack is used as the checkpointer thread_id for continuity.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { HumanMessage } from "@langchain/core/messages";
import {
  createProductAgentGraph,
  getProductAgentCheckpointer,
  type ProductAgentPhase,
  type ProductAgentState,
} from "../../product-agent/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:temporal:product-agent-activity",
});

/**
 * Input for running the product agent activity
 */
export interface RunProductAgentActivityInput {
  /** Slack thread timestamp - used as checkpointer thread_id */
  threadTs: string;
  /** User's message to process */
  message: string;
  /** Linear team ID for issue creation */
  teamId: string;
}

/**
 * Output from the product agent activity
 */
export interface RunProductAgentActivityOutput {
  /** AI response to send back to Slack */
  response: string;
  /** Current conversation phase */
  phase: ProductAgentPhase;
  /** Linear issue ID if one was created */
  issueId?: string | undefined;
  /** Linear issue identifier (e.g., "ABC-123") if one was created */
  issueIdentifier?: string | undefined;
}

/**
 * Extract text content from a LangGraph message.
 *
 * Messages can have string content or array content (multimodal).
 * This extracts just the text portion.
 */
function extractMessageContent(
  message: ProductAgentState["messages"][number],
): string {
  const content = message.content;

  // String content (most common)
  if (typeof content === "string") {
    return content;
  }

  // Array content (multimodal messages)
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text: string } => {
        return (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part
        );
      })
      .map((part) => part.text)
      .join("\n");
  }

  // Fallback
  return String(content);
}

/**
 * Run the product agent as a Temporal activity.
 *
 * This activity invokes the LangGraph product agent workflow with:
 * - Checkpointer for conversation history persistence
 * - Thread ID as the configurable thread_id for multi-turn conversations
 *
 * @param input - Activity input with thread, message, and team ID
 * @returns Activity output with response, phase, and optional issue info
 */
export async function runProductAgentActivity(
  input: RunProductAgentActivityInput,
): Promise<RunProductAgentActivityOutput> {
  const { threadTs, message, teamId } = input;

  logger.info(
    { threadTs, teamId, messageLength: message.length },
    "Running product agent activity",
  );

  // Get the checkpointer (must be initialized at worker startup)
  const checkpointer = getProductAgentCheckpointer();

  // Create the graph with checkpointer
  const graph = createProductAgentGraph({
    teamId,
    checkpointer,
  });

  // Create the input message
  const inputMessage = new HumanMessage(message);

  // Invoke the graph with thread_id for conversation continuity
  const result = await graph.invoke(
    {
      messages: [inputMessage],
    },
    {
      configurable: {
        thread_id: threadTs,
      },
    },
  );

  // Extract the last AI message as response
  const messages = result.messages || [];
  const lastMessage = messages[messages.length - 1];
  const response = lastMessage ? extractMessageContent(lastMessage) : "";

  // Extract created task info if any
  const createdTasks = result.createdTasks || [];
  const firstTask = createdTasks[0];

  logger.info(
    {
      threadTs,
      phase: result.phase,
      hasIssue: !!firstTask,
      issueId: firstTask?.id,
      responseLength: response.length,
    },
    "Product agent activity complete",
  );

  return {
    response,
    phase: result.phase,
    issueId: firstTask?.id,
    issueIdentifier: firstTask?.identifier,
  };
}
