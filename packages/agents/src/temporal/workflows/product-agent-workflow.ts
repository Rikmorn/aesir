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
 *
 * The workflow invokes LangGraph for AI reasoning and uses MCP for
 * integration communication (Slack replies, Linear issue creation).
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
 * Activities are bound at worker startup via makeActivities().
 */
interface ProductAgentActivities {
  runProductAgentActivity: (input: {
    threadTs: string;
    message: string;
    teamId: string;
  }) => Promise<{
    response: string;
    phase: string;
    issueId?: string;
    issueIdentifier?: string;
  }>;

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
    startToCloseTimeout: "5 minutes", // LLM reasoning can take time
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
 * 1. Process initial message via LangGraph
 * 2. Send AI response to Slack thread
 * 3. Wait for user reply signal (24h timeout)
 * 4. If no reply in 24h, send reminder and wait 48h more
 * 5. Repeat until:
 *    - Issue created (complete)
 *    - Message declined (declined)
 *    - User cancels (cancelled)
 *    - 72h timeout (timeout)
 *    - Max iterations reached
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

    // Run LangGraph agent
    state.phase = "running";
    wf.log.info(`Running product agent (iteration ${state.iterations})`, {
      threadTs,
      messageLength: currentMessage.length,
    });

    let agentResult: Awaited<ReturnType<typeof runProductAgentActivity>>;
    try {
      // Get LINEAR_TEAM_ID from environment (set by worker)
      // Note: In Temporal workflows, we pass config through input
      agentResult = await runProductAgentActivity({
        threadTs,
        message: currentMessage,
        teamId: process.env.LINEAR_TEAM_ID ?? "",
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

    // Send agent response to Slack
    wf.log.info("Sending response to Slack", {
      threadTs,
      responseLength: agentResult.response.length,
      agentPhase: agentResult.phase,
    });

    try {
      await sendSlackReplyActivity(channelId, threadTs, agentResult.response);
    } catch (error) {
      wf.log.warn("Failed to send Slack response", { error, threadTs });
      // Continue - response failure shouldn't fail the workflow
    }

    // Check terminal states from LangGraph
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
