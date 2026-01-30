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
    const history = conversationHistory
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    initialMessage = `<conversation_history>\n${history}\n</conversation_history>\n\nNew message from user:\n${message}`;
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
