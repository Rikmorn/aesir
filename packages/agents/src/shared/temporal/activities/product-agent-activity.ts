/**
 * Product Agent Temporal Activity
 *
 * Wraps `runProductAgent()` as a Temporal activity. Replaces the previous
 * LangGraph-based implementation with the agentic tool-use loop.
 *
 * Key changes from the LangGraph version:
 * - No LangGraph imports (no checkpointer, no graph, no HumanMessage)
 * - Conversation history passed via input, injected into initial message
 * - Phase extracted from XML tags in agent output (not state machine)
 * - Issue info extracted from trace (linear_create_issue tool results)
 * - Module-level DI pattern for db and logger (matches orchestrator-activities.ts)
 *
 * The activity no longer sends Slack messages -- the agent does that via
 * its slack_send_message tool. The `response` field contains internal
 * reasoning + phase tag for workflow flow control.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { runProductAgent } from "../../../product-agent/orchestrator/index.js";
import type { AgentLoopResult, TraceStep } from "../../agent-loop/types.js";
import type * as agentsSchemaModule from "../../db/schema.js";
import type { ProductAgentWorkflowPhase } from "../types.js";

// ---------------------------------------------------------------------------
// Dependency Injection
// ---------------------------------------------------------------------------

/**
 * Dependencies required by product agent activities.
 * Injected via initProductAgentActivities at worker startup.
 */
export interface ProductAgentActivityDeps {
  /** Database client for trace recording */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger instance */
  logger: PinoLogger;
}

/** Module-level dependencies - must be initialized before use */
let deps: ProductAgentActivityDeps | null = null;

/**
 * Initialize product agent activities with dependencies.
 *
 * Must be called at Temporal worker startup before any activities run.
 *
 * @param dependencies - All required dependencies for product agent activities
 */
export function initProductAgentActivities(
  dependencies: ProductAgentActivityDeps,
): void {
  deps = dependencies;
  dependencies.logger.info("Product agent activities initialized");
}

/**
 * Get dependencies, throwing if not initialized.
 */
function getProductAgentDeps(): ProductAgentActivityDeps {
  if (!deps) {
    throw new Error(
      "Product agent activities not initialized. Call initProductAgentActivities() at worker startup.",
    );
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Activity Input/Output Types
// ---------------------------------------------------------------------------

/**
 * Input for running the product agent activity.
 */
export interface RunProductAgentActivityInput {
  /** Slack thread timestamp (unique conversation identifier) */
  threadTs: string;
  /** User's message to process */
  message: string;
  /** Linear team ID for issue creation */
  teamId: string;
  /** Slack channel ID for context */
  channelId: string;
  /** Full conversation history for multi-turn context */
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

/**
 * Output from the product agent activity.
 *
 * Slim serializable output that respects Temporal's gRPC size limits.
 * Does NOT include the full execution trace.
 */
export interface RunProductAgentActivityOutput {
  /** Agent's internal reasoning output (includes phase tag) */
  response: string;
  /** Extracted conversation phase for workflow flow control */
  phase: ProductAgentWorkflowPhase;
  /** Linear issue ID if one was created */
  issueId?: string | undefined;
  /** Linear issue identifier (e.g., "ABC-123") if one was created */
  issueIdentifier?: string | undefined;
}

// ---------------------------------------------------------------------------
// Phase Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the conversation phase from the agent loop result.
 *
 * Parses `<phase>...</phase>` XML tags from the agent's text output.
 * Maps parsed values to ProductAgentWorkflowPhase:
 * - "complete"   -> "complete"
 * - "declined"   -> "declined"
 * - "cancelled"  -> "cancelled"
 * - "clarifying" -> "awaiting_reply"
 *
 * Defaults to "awaiting_reply" if no phase tag found (safe default --
 * continues the conversation rather than terminating prematurely).
 *
 * @param result - Agent loop result containing text output with phase tag
 * @returns Extracted workflow phase
 */
export function extractPhase(
  result: AgentLoopResult,
): ProductAgentWorkflowPhase {
  const phaseMatch = result.output.match(/<phase>(.*?)<\/phase>/);
  if (!phaseMatch) {
    return "awaiting_reply";
  }

  const phase = phaseMatch[1];
  switch (phase) {
    case "complete":
      return "complete";
    case "declined":
      return "declined";
    case "cancelled":
      return "cancelled";
    case "clarifying":
      return "awaiting_reply";
    default:
      return "awaiting_reply";
  }
}

// ---------------------------------------------------------------------------
// Issue Info Extraction
// ---------------------------------------------------------------------------

/**
 * Parsed issue information from a linear_create_issue tool result.
 */
interface IssueInfo {
  issueId: string;
  issueIdentifier: string;
}

/**
 * Extract created issue information from the agent loop trace.
 *
 * Scans the execution trace for `tool_result` steps from `linear_create_issue`.
 * The tool result's `output` field contains a JSON-serialized string matching
 * the Linear MCP CreateIssueOutputSchema: `{ id, identifier, url, title }`.
 *
 * Takes the first matching step (there should be at most one issue creation
 * per conversation turn).
 *
 * @param result - Agent loop result containing the execution trace
 * @returns Parsed issue info, or null if no issue was created
 */
export function extractIssueInfo(result: AgentLoopResult): IssueInfo | null {
  for (const step of result.trace) {
    if (
      step.type === "tool_result" &&
      step.toolName === "linear_create_issue"
    ) {
      return parseIssueFromTraceStep(step);
    }
  }
  return null;
}

/**
 * Parse issue info from a single trace step's output.
 *
 * The output is a JSON-serialized string from the MCP tool wrapper.
 * Returns null on parse errors (defensive against malformed tool results).
 */
function parseIssueFromTraceStep(step: TraceStep): IssueInfo | null {
  try {
    const output = step.output;
    if (typeof output !== "string") {
      return null;
    }

    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "identifier" in parsed &&
      typeof (parsed as { id: unknown }).id === "string" &&
      typeof (parsed as { identifier: unknown }).identifier === "string"
    ) {
      return {
        issueId: (parsed as { id: string }).id,
        issueIdentifier: (parsed as { identifier: string }).identifier,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Activity: Run Product Agent
// ---------------------------------------------------------------------------

/**
 * Run the product agent as a Temporal activity.
 *
 * This activity invokes `runProductAgent()` which runs an agentic tool-use
 * loop for a single conversation turn. The agent:
 * - Receives the user's message and conversation history
 * - Reasons about what to do (clarify, create issue, decline, etc.)
 * - Communicates with the user via slack_send_message tool
 * - Optionally creates Linear issues via linear_create_issue tool
 * - Ends with a phase tag indicating the next workflow action
 *
 * The activity extracts the phase and issue info from the agent's output
 * and returns a slim serializable result for the Temporal workflow.
 *
 * @param input - Activity input with thread, message, channel, and history
 * @returns Activity output with response, phase, and optional issue info
 */
export async function runProductAgentActivity(
  input: RunProductAgentActivityInput,
): Promise<RunProductAgentActivityOutput> {
  const activeDeps = getProductAgentDeps();
  const activityLogger = activeDeps.logger.child({
    activity: "runProductAgentActivity",
    threadTs: input.threadTs,
  });

  activityLogger.info(
    {
      channelId: input.channelId,
      teamId: input.teamId,
      messageLength: input.message.length,
      historyLength: input.conversationHistory?.length ?? 0,
    },
    "Running product agent activity",
  );

  // Run the agentic loop for this conversation turn
  // Mutable-then-conditional-set for exactOptionalPropertyTypes
  const agentOptions: Parameters<typeof runProductAgent>[0] = {
    threadTs: input.threadTs,
    channelId: input.channelId,
    message: input.message,
    linearTeamId: input.teamId,
    agentId: "product-agent",
    correlationId: `product-${input.threadTs}`,
    db: activeDeps.db,
    logger: activeDeps.logger,
  };
  if (input.conversationHistory !== undefined) {
    agentOptions.conversationHistory = input.conversationHistory;
  }
  const result = await runProductAgent(agentOptions);

  // Extract phase from agent output
  const phase = extractPhase(result);

  // Extract issue info from trace (if agent created an issue)
  const issueInfo = extractIssueInfo(result);

  // Build slim output (no full trace -- Temporal gRPC limit)
  const output: RunProductAgentActivityOutput = {
    response: result.output,
    phase,
  };
  // Conditional property assignment for exactOptionalPropertyTypes
  if (issueInfo !== null) {
    output.issueId = issueInfo.issueId;
    output.issueIdentifier = issueInfo.issueIdentifier;
  }

  activityLogger.info(
    {
      phase,
      hasIssue: issueInfo !== null,
      toolCallCount: result.toolCallCount,
      status: result.status,
    },
    "Product agent activity complete",
  );

  return output;
}
