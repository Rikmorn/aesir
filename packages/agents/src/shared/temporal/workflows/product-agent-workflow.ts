/**
 * Product Agent Conversation Workflow
 *
 * Temporal workflow that orchestrates multi-turn Slack conversations for
 * gathering requirements and creating Linear issues.
 *
 * Key behaviors:
 * - Waits for user reply signals with configurable timeouts
 * - Sends reminders after 24h of inactivity
 * - Times out after 72h total
 * - Handles cancellation signals gracefully
 * - Persists conversation state through process restarts
 * - Tracks conversation history for multi-turn context injection
 *
 * The workflow invokes the agentic tool-use loop for AI reasoning.
 * The agent sends its own Slack messages via tools during its turn.
 * The workflow only sends system-level messages (reminders, timeouts,
 * cancellation acknowledgments).
 */

import * as wf from "@temporalio/workflow";
import { proxyActivities } from "@temporalio/workflow";

import { cancelConversationSignal, userReplySignal } from "../signals.js";
import type {
  ProductAgentWorkflowInput,
  ProductAgentWorkflowPhase,
  ProductAgentWorkflowResult,
} from "../types.js";

/**
 * Activity types for this workflow.
 *
 * Redeclared here to satisfy Temporal's determinism constraint --
 * workflow code must not import from non-workflow modules.
 */
interface ProductAgentActivities {
  runProductAgentActivity: (input: {
    threadTs: string;
    message: string;
    teamId: string;
    channelId: string;
    conversationHistory?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
  }) => Promise<{
    response: string;
    phase: string;
    issueId?: string;
    issueIdentifier?: string;
  }>;

  /**
   * Send a message to a Slack thread.
   *
   * Still used for workflow-level system messages:
   * - Cancellation acknowledgment
   * - 24h inactivity reminder
   * - 72h timeout notification
   * - Max iterations notification
   *
   * NOT used after agent turns -- the agent sends its own messages
   * via the slack_send_message tool during its agentic loop.
   */
  sendSlackReplyActivity: (
    channelId: string,
    threadTs: string,
    text: string,
  ) => Promise<{
    success: boolean;
    ts?: string;
  }>;
}

// Configure activities with appropriate timeouts
const { runProductAgentActivity, sendSlackReplyActivity } =
  proxyActivities<ProductAgentActivities>({
    startToCloseTimeout: "5 minutes", // Agentic loop reasoning can take time
    retry: {
      maximumAttempts: 3,
      initialInterval: "1 second",
      backoffCoefficient: 2,
    },
  });

/**
 * Query for checking conversation status
 */
export interface ConversationQueryStatus {
  /** Slack thread timestamp (conversation ID) */
  threadTs: string;
  /** Current workflow phase */
  phase: ProductAgentWorkflowPhase;
  /** Number of conversation iterations completed */
  iterations: number;
  /** Linear issue ID if created */
  issueId?: string | undefined;
  /** Linear issue identifier if created */
  issueIdentifier?: string | undefined;
}

export const conversationStatusQuery =
  wf.defineQuery<ConversationQueryStatus>("conversationStatus");

/**
 * Product Agent Conversation Workflow
 *
 * Orchestrates multi-turn Slack conversations with timeout handling
 * and signal-based user reply processing.
 *
 * Flow:
 * 1. Process message via agentic tool-use loop (agent sends its own Slack replies)
 * 2. Check agent phase for terminal states (complete, declined)
 * 3. Wait for user reply signal (24h timeout)
 * 4. If no reply in 24h, send reminder and wait 48h more
 * 5. Repeat until:
 *    - Issue created (complete)
 *    - Message declined (declined)
 *    - User cancels (cancelled)
 *    - 72h timeout (timeout)
 *    - Max iterations reached
 *
 * The agent communicates with the user directly via slack_send_message tool
 * during its agentic loop. The workflow only sends system-level messages
 * (reminders, timeouts, cancellation acknowledgments).
 *
 * @param input - Workflow input with thread context and initial message
 * @returns Workflow result with terminal phase and optional issue info
 */
export async function productAgentConversationWorkflow(
  input: ProductAgentWorkflowInput,
): Promise<ProductAgentWorkflowResult> {
  const { threadTs, channelId, initialMessage } = input;
  // slackTeamId is available in input for future MCP calls if needed

  // Maximum conversation iterations (prevents infinite loops)
  const maxIterations = 20;

  // Timeout configuration
  const firstReplyTimeout = "24 hours";
  const reminderTimeout = "48 hours"; // After reminder, wait this long

  // Mutable workflow state for signal handlers
  const state = {
    phase: "pending" as ProductAgentWorkflowPhase,
    iterations: 0,
    userReply: null as string | null,
    cancelRequested: false,
    issueId: undefined as string | undefined,
    issueIdentifier: undefined as string | undefined,
  };

  // Set up signal handlers
  wf.setHandler(userReplySignal, (reply: string) => {
    wf.log.info("Received user reply signal", {
      threadTs,
      replyLength: reply.length,
    });
    state.userReply = reply;
  });

  wf.setHandler(cancelConversationSignal, () => {
    wf.log.info("Received cancel signal", { threadTs });
    state.cancelRequested = true;
  });

  // Set up query handler
  wf.setHandler(
    conversationStatusQuery,
    (): ConversationQueryStatus => ({
      threadTs,
      phase: state.phase,
      iterations: state.iterations,
      issueId: state.issueId,
      issueIdentifier: state.issueIdentifier,
    }),
  );

  // Conversation history for multi-turn context injection.
  // Each turn appends the user message and agent response so the
  // agentic loop has full context across Temporal activity boundaries.
  const conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];

  // Process initial message
  let currentMessage = initialMessage;

  // Main conversation loop
  while (state.iterations < maxIterations) {
    state.iterations++;

    // Check for cancellation
    if (state.cancelRequested) {
      wf.log.info("Conversation cancelled by user", { threadTs });
      state.phase = "cancelled";

      // Send cancellation acknowledgment
      try {
        await sendSlackReplyActivity(
          channelId,
          threadTs,
          "Got it, I've cancelled this conversation. Feel free to start a new one anytime!",
        );
      } catch {
        wf.log.warn("Failed to send cancellation message", { threadTs });
      }

      await wf.condition(wf.allHandlersFinished);
      return {
        success: false,
        phase: "cancelled",
      };
    }

    // Run agentic tool-use loop
    state.phase = "running";
    wf.log.info(`Running product agent (iteration ${state.iterations})`, {
      threadTs,
      messageLength: currentMessage.length,
      historyLength: conversationHistory.length,
    });

    // Track the user message in conversation history
    conversationHistory.push({ role: "user", content: currentMessage });

    let agentResult: Awaited<ReturnType<typeof runProductAgentActivity>>;
    try {
      agentResult = await runProductAgentActivity({
        threadTs,
        message: currentMessage,
        teamId: input.linearTeamId,
        channelId,
        conversationHistory,
      });
    } catch (error) {
      wf.log.error("Product agent activity failed", { error, threadTs });
      state.phase = "timeout"; // Treat activity failure as timeout

      await wf.condition(wf.allHandlersFinished);
      return {
        success: false,
        phase: "timeout",
      };
    }

    // Track agent response in conversation history (if non-empty).
    // The response contains internal reasoning + phase tag, but we
    // track it for context continuity across turns.
    if (agentResult.response.length > 0) {
      conversationHistory.push({
        role: "assistant",
        content: agentResult.response,
      });
    }

    // The agent sends its own Slack messages via the slack_send_message
    // tool during its agentic loop. The response field is internal
    // reasoning + phase tag -- do NOT send it to Slack.
    wf.log.info("Agent turn complete", {
      threadTs,
      agentPhase: agentResult.phase,
      responseLength: agentResult.response.length,
    });

    // Check terminal states from agent phase
    if (agentResult.phase === "complete") {
      wf.log.info("Issue created successfully", {
        threadTs,
        issueId: agentResult.issueId,
        issueIdentifier: agentResult.issueIdentifier,
      });
      state.phase = "complete";
      state.issueId = agentResult.issueId;
      state.issueIdentifier = agentResult.issueIdentifier;

      await wf.condition(wf.allHandlersFinished);
      const result: ProductAgentWorkflowResult = {
        success: true,
        phase: "complete",
      };
      if (agentResult.issueId) {
        result.issueId = agentResult.issueId;
      }
      if (agentResult.issueIdentifier) {
        result.issueIdentifier = agentResult.issueIdentifier;
      }
      return result;
    }

    if (agentResult.phase === "declined") {
      wf.log.info("Message declined (non-actionable)", { threadTs });
      state.phase = "declined";

      await wf.condition(wf.allHandlersFinished);
      return {
        success: true, // Declined is a successful outcome, not a failure
        phase: "declined",
      };
    }

    // Wait for user reply with timeout
    state.phase = "awaiting_reply";
    state.userReply = null; // Reset for this iteration

    wf.log.info("Waiting for user reply", {
      threadTs,
      timeout: firstReplyTimeout,
    });

    // First timeout: 24 hours
    const receivedFirstReply = await wf.condition(
      () => state.userReply !== null || state.cancelRequested,
      firstReplyTimeout,
    );

    // Check for cancellation
    if (state.cancelRequested) {
      continue; // Will handle at start of next iteration
    }

    // If no reply in 24h, send reminder and wait longer
    if (!receivedFirstReply) {
      wf.log.info("No reply in 24h, sending reminder", { threadTs });

      try {
        await sendSlackReplyActivity(
          channelId,
          threadTs,
          "Hey! Just checking in - still want to create this feature request? Let me know if you have any updates or want to continue.",
        );
      } catch {
        wf.log.warn("Failed to send reminder", { threadTs });
      }

      // Wait another 48 hours (72h total)
      const receivedLateReply = await wf.condition(
        () => state.userReply !== null || state.cancelRequested,
        reminderTimeout,
      );

      // Check for cancellation
      if (state.cancelRequested) {
        continue;
      }

      // Still no reply - timeout
      if (!receivedLateReply) {
        wf.log.info("Conversation timed out after 72h", { threadTs });
        state.phase = "timeout";

        try {
          await sendSlackReplyActivity(
            channelId,
            threadTs,
            "This conversation has timed out after 72 hours of inactivity. Feel free to start a new conversation anytime!",
          );
        } catch {
          wf.log.warn("Failed to send timeout message", { threadTs });
        }

        await wf.condition(wf.allHandlersFinished);
        return {
          success: false,
          phase: "timeout",
        };
      }
    }

    // User replied - continue conversation
    // At this point, either receivedFirstReply or receivedLateReply was true,
    // and we didn't have cancellation or timeout, so userReply must be set.
    // TypeScript can't track signal handlers setting state, so we use assertion.
    const userReply = state.userReply as unknown as string;
    wf.log.info("User replied, continuing conversation", {
      threadTs,
      replyLength: userReply.length,
    });
    currentMessage = userReply;
  }

  // Exceeded max iterations
  wf.log.warn("Max iterations exceeded", { threadTs, maxIterations });
  state.phase = "timeout";

  try {
    await sendSlackReplyActivity(
      channelId,
      threadTs,
      "This conversation has reached its maximum length. Please start a new conversation to continue.",
    );
  } catch {
    wf.log.warn("Failed to send max iterations message", { threadTs });
  }

  await wf.condition(wf.allHandlersFinished);
  return {
    success: false,
    phase: "timeout",
  };
}
