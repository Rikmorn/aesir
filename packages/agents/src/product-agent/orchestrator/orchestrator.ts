/**
 * Product Agent Orchestrator
 *
 * Entry point for the product agent that replaces the 6-node LangGraph
 * graph with an agentic tool-use loop. Wires together:
 *
 * - PRODUCT_AGENT_SYSTEM_PROMPT (behavior definition)
 * - createProductAgentToolkit (5 tools: Linear + Slack)
 * - runAgentLoop (core runtime)
 * - createTraceRecorder (observability)
 * - createTokenBudget (cost control)
 *
 * The product agent is simpler than the dev-agent orchestrator: no sub-agents,
 * no container management, no approval gates. It is a conversational agent
 * that runs one turn per Temporal activity invocation.
 *
 * Usage:
 *   const result = await runProductAgent({
 *     threadTs: "1234567890.123456",
 *     channelId: "C0123456789",
 *     message: "We need a dark mode toggle",
 *     linearTeamId: "team_abc",
 *     agentId: "product-agent",
 *     correlationId: "product-1234567890.123456",
 *     db,
 *     logger,
 *   });
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import Anthropic from "@anthropic-ai/sdk";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { runAgentLoop } from "../../shared/agent-loop/run-agent-loop.js";
import { createTokenBudget } from "../../shared/agent-loop/token-budget.js";
import type {
  AgentLoopOptions,
  AgentLoopResult,
} from "../../shared/agent-loop/types.js";
import type * as agentsSchemaModule from "../../shared/db/schema.js";
import { createTraceRecorder } from "../../shared/db/trace-recorder.js";
import { createProductAgentToolkit } from "../../shared/tools/toolkits.js";
import { PRODUCT_AGENT_SYSTEM_PROMPT } from "./system-prompts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for running the product agent.
 *
 * Required: threadTs, channelId, message, linearTeamId, agentId,
 *           correlationId, db, logger
 * Optional: conversationHistory, maxIterations, maxTokenBudget
 */
export interface ProductAgentOptions {
  /** Slack thread timestamp (unique conversation identifier) */
  threadTs: string;
  /** Slack channel ID for context */
  channelId: string;
  /** User's current message to process */
  message: string;
  /** Previous conversation history for multi-turn context */
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Linear team ID for issue creation */
  linearTeamId: string;
  /** Agent identifier for MCP permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Database client for trace recording */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger for agent diagnostics */
  logger: PinoLogger;
  /** Maximum agent loop iterations (default: 10) */
  maxIterations?: number;
  /** Maximum token budget for this turn (default: 50_000) */
  maxTokenBudget?: number;
}

// ---------------------------------------------------------------------------
// Conversation History Compaction
// ---------------------------------------------------------------------------

/** Message type used throughout history management */
type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * Escape XML-special characters in user/agent message content.
 *
 * History is injected inside XML-tagged sections (<conversation_history>,
 * <conversation_summary>). Without escaping, user messages containing XML
 * (e.g., "<button>", "</conversation_history>", "<phase>complete</phase>")
 * could break the tag structure or be misinterpreted as system directives.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a history message with role label and escaped content.
 */
function formatMessage(m: HistoryMessage): string {
  return `${m.role === "user" ? "User" : "Agent"}: ${escapeXml(m.content)}`;
}

/**
 * Number of recent messages to keep verbatim.
 * 12 messages ≈ 6 user/agent exchanges — enough for the agent to follow
 * the current thread of conversation without needing the summary.
 */
const RECENT_MESSAGES_TO_KEEP = 12;

/**
 * Threshold at which compaction kicks in.
 * Below this, history is passed through as-is. At or above, older
 * messages are summarized and only recent ones kept verbatim.
 */
const COMPACTION_THRESHOLD = 16;

/**
 * Model used for summarization. Haiku is fast (~1-2s) and cheap,
 * suitable for a utility summarization call.
 */
const COMPACTION_MODEL = "claude-haiku-4-20250514";

/**
 * Prompt sent to the compaction model to summarize older conversation turns.
 */
const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Given a conversation between a user and an agent about creating Linear issues, produce a concise summary capturing:

- What the user requested (feature, bug, etc.)
- Key decisions made (priority, scope, labels discussed)
- Information gathered (acceptance criteria, context provided)
- Any issues found (duplicates, blockers, tool errors)
- Current status (waiting for confirmation, clarifying details, etc.)

Output ONLY the summary as a bulleted list. No preamble, no commentary. Keep it under 500 words.`;

/**
 * Compact conversation history to stay within token budget.
 *
 * When history exceeds COMPACTION_THRESHOLD messages, splits into:
 * - Older messages → summarized by a fast LLM call
 * - Recent messages → kept verbatim (last RECENT_MESSAGES_TO_KEEP)
 *
 * Returns a formatted string ready for injection into the initial message.
 * Falls back to keeping only recent messages if the summary call fails.
 *
 * The full history is preserved in the Temporal workflow state for
 * audit and debugging. Compaction only affects what the LLM sees.
 *
 * @param history - Full conversation history from the workflow
 * @param logger - Logger for diagnostics
 * @param anthropicClient - Optional Anthropic client (for testing). Created if not provided.
 * @returns Formatted history string and whether compaction was applied
 */
export async function compactConversationHistory(
  history: HistoryMessage[],
  logger: PinoLogger,
  anthropicClient?: Anthropic,
): Promise<{ formatted: string; compacted: boolean }> {
  // Below threshold — pass through as-is
  if (history.length < COMPACTION_THRESHOLD) {
    const formatted = history.map(formatMessage).join("\n\n");
    return { formatted, compacted: false };
  }

  // Split into old (to summarize) and recent (to keep verbatim)
  const splitIndex = history.length - RECENT_MESSAGES_TO_KEEP;
  const olderMessages = history.slice(0, splitIndex);
  const recentMessages = history.slice(splitIndex);

  logger.info(
    {
      totalMessages: history.length,
      summarizing: olderMessages.length,
      keepingVerbatim: recentMessages.length,
    },
    "Compacting conversation history",
  );

  // Summarize older messages
  let summary: string;
  try {
    const client = anthropicClient ?? new Anthropic({ maxRetries: 2 });
    const olderText = olderMessages.map(formatMessage).join("\n\n");

    const response = await client.messages.create({
      model: COMPACTION_MODEL,
      max_tokens: 1024,
      system: COMPACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: olderText }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    summary = textBlock?.text ?? "";

    if (!summary) {
      throw new Error("Compaction model returned no text content");
    }

    logger.info(
      { summaryLength: summary.length, model: COMPACTION_MODEL },
      "Conversation history compacted successfully",
    );
  } catch (error) {
    // Fallback: drop older messages instead of blocking the conversation
    logger.warn(
      { error },
      "Conversation history compaction failed, falling back to recent messages only",
    );

    const recentFormatted = recentMessages.map(formatMessage).join("\n\n");

    return {
      formatted: `[${olderMessages.length} earlier messages could not be summarized and were omitted]\n\n${recentFormatted}`,
      compacted: true,
    };
  }

  // Combine summary + recent verbatim messages
  const recentFormatted = recentMessages.map(formatMessage).join("\n\n");

  const formatted = `<conversation_summary>\nSummary of ${olderMessages.length} earlier messages:\n${summary}\n</conversation_summary>\n\nRecent messages:\n${recentFormatted}`;

  return { formatted, compacted: true };
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

/**
 * Run the product agent for a single conversation turn.
 *
 * This is the top-level entry point that replaces the 6-node LangGraph graph.
 * It creates a token budget, trace recorder, and toolkit, then launches
 * runAgentLoop() with the product agent system prompt.
 *
 * The agent reads the user's message (with optional conversation history),
 * reasons about what to do, communicates via Slack tool calls, and optionally
 * creates Linear issues. It ends each turn with a phase tag that the Temporal
 * activity parses to determine workflow flow.
 *
 * @param options - Product agent configuration
 * @returns Agent loop result with status, output, and trace
 */
export async function runProductAgent(
  options: ProductAgentOptions,
): Promise<AgentLoopResult> {
  const {
    threadTs,
    channelId,
    message,
    conversationHistory,
    linearTeamId,
    agentId,
    correlationId,
    db,
    logger,
  } = options;

  // 1. Create token budget
  const tokenBudget = createTokenBudget(options.maxTokenBudget ?? 50_000);

  // 2. Generate unique agent instance ID
  const agentInstanceId = createId.agentInstance();

  // 3. Create trace recorder for observability
  const traceRecorder = createTraceRecorder({
    db,
    logger,
    taskId: `product-${threadTs}`,
    workflowId: `product-agent-${threadTs}`,
    agentType: "product-agent",
    agentInstanceId,
  });

  // 4. Create product agent toolkit (5 tools)
  const tools = createProductAgentToolkit({ agentId, correlationId });

  // 5. Build initial message with optional conversation history
  let initialMessage: string;
  if (conversationHistory !== undefined && conversationHistory.length > 0) {
    const { formatted, compacted } = await compactConversationHistory(
      conversationHistory,
      logger,
    );

    if (compacted) {
      logger.info("Using compacted conversation history for agent turn");
    }

    initialMessage = `<conversation_history>\n${formatted}\n</conversation_history>\n\nNew message from user:\n${message}`;
  } else {
    initialMessage = message;
  }

  // 6. Build context string with Slack and Linear metadata
  const context = `<slack_context>\nChannel: ${channelId}\nThread: ${threadTs}\nLinear Team ID: ${linearTeamId}\n</slack_context>`;

  // 7. Build agent loop options
  const loopOptions: AgentLoopOptions = {
    systemPrompt: PRODUCT_AGENT_SYSTEM_PROMPT,
    tools,
    initialMessage,
    context,
    maxIterations: options.maxIterations ?? 10,
    tokenBudget,
    onToolCall: traceRecorder.onToolCall,
    onResponse: traceRecorder.onResponse,
    logger: logger.child({
      component: "product-agent",
      agentInstanceId,
    }),
  };

  // 8. Run the agent loop
  try {
    const result = await runAgentLoop(loopOptions);
    return result;
  } finally {
    // Always flush traces, even on error
    await traceRecorder.flush();
  }
}
