/**
 * Dev Agent Orchestrator
 *
 * Entry point for the dev agent orchestrator that replaces the 13-node
 * LangGraph graph with an agentic tool-use loop. Wires together:
 *
 * - ORCHESTRATOR_SYSTEM_PROMPT (behavior definition)
 * - createOrchestratorToolkit (14 tools: codebase + coordination + integration)
 * - runAgentLoop (core runtime)
 * - createTraceRecorder (observability)
 * - createTokenBudget (cost control)
 *
 * Usage:
 *   const result = await runDevAgentOrchestrator({
 *     issueId: "AES-42",
 *     containerManager,
 *     taskId: "task_abc",
 *     agentId: "dev-agent",
 *     correlationId: "corr_xyz",
 *     workflowId: "wf_123",
 *     db,
 *     logger,
 *   });
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
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
import { createOrchestratorToolkit } from "../../shared/tools/toolkits.js";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./system-prompts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for running the dev agent orchestrator.
 *
 * Required: issueId, containerManager, taskId, agentId, correlationId,
 *           workflowId, db, logger
 * Optional: issueTitle, maxIterations, maxTokenBudget, model, abortSignal
 */
export interface OrchestratorOptions {
  /** External issue identifier (e.g., "AES-42") */
  issueId: string;
  /** Issue title for initial context (avoids an extra API call when known) */
  issueTitle?: string;
  /** Container manager for sandbox execution */
  containerManager: DevContainerManager;
  /** External task ID (maps to agents.tasks.task_id) */
  taskId: string;
  /** Agent identifier for MCP permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Temporal workflow ID for trace association */
  workflowId: string;
  /** Database client for trace recording */
  db: NodePgDatabase<typeof agentsSchemaModule>;
  /** Logger for orchestrator diagnostics */
  logger: PinoLogger;
  /** Maximum agent loop iterations (default: 100) */
  maxIterations?: number;
  /** Maximum token budget across orchestrator and all sub-agents (default: 500_000) */
  maxTokenBudget?: number;
  /** LLM model override (default: loop default) */
  model?: string;
  /** Abort signal for clean cancellation */
  abortSignal?: AbortSignal;
  /** Called after each LLM response for Temporal activity heartbeats */
  onHeartbeat?: () => void;
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

/**
 * Run the dev agent orchestrator.
 *
 * This is the top-level entry point that replaces the 13-node LangGraph
 * graph. It creates a token budget, trace recorder, and toolkit, then
 * launches runAgentLoop() with the orchestrator system prompt.
 *
 * The orchestrator reads the issue, reasons about complexity, delegates
 * to sub-agents (researcher, coder, tester), and produces working code
 * changes committed as a pull request.
 *
 * @param options - Orchestrator configuration
 * @returns Agent loop result with status, output, and trace
 */
export async function runDevAgentOrchestrator(
  options: OrchestratorOptions,
): Promise<AgentLoopResult> {
  const {
    issueId,
    issueTitle,
    containerManager,
    taskId,
    agentId,
    correlationId,
    workflowId,
    db,
    logger,
  } = options;

  // 1. Create token budget
  const tokenBudget = createTokenBudget(options.maxTokenBudget ?? 500_000);

  // 2. Generate unique agent instance ID
  const agentInstanceId = createId.agentInstance();

  // 3. Create trace recorder for observability
  const traceRecorder = createTraceRecorder({
    db,
    logger,
    taskId,
    workflowId,
    agentType: "dev-orchestrator",
    agentInstanceId,
  });

  // 4. Create orchestrator toolkit (14 tools)
  const toolkitDeps = {
    containerManager,
    taskId,
    agentId,
    correlationId,
    logger,
    tokenBudget,
    traceRecorder,
  };
  // Mutable-then-conditional-set for exactOptionalPropertyTypes
  if (options.abortSignal !== undefined) {
    (toolkitDeps as { abortSignal?: AbortSignal }).abortSignal =
      options.abortSignal;
  }
  const tools = createOrchestratorToolkit(toolkitDeps);

  // 5. Build initial message
  let initialMessage = `Implement issue ${issueId}.`;
  if (issueTitle !== undefined) {
    initialMessage += ` Title: "${issueTitle}"`;
  }

  // 6. Build agent loop options
  const loopOptions: AgentLoopOptions = {
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    tools,
    initialMessage,
    maxIterations: options.maxIterations ?? 100,
    tokenBudget,
    onToolCall: traceRecorder.onToolCall,
    onResponse: traceRecorder.onResponse,
    logger: logger.child({
      component: "dev-orchestrator",
      agentInstanceId,
    }),
  };
  // Mutable-then-conditional-set for exactOptionalPropertyTypes
  if (options.model !== undefined) {
    loopOptions.model = options.model;
  }
  if (options.abortSignal !== undefined) {
    loopOptions.abortSignal = options.abortSignal;
  }
  if (options.onHeartbeat !== undefined) {
    loopOptions.onHeartbeat = options.onHeartbeat;
  }

  // 7. Run the agent loop
  try {
    const result = await runAgentLoop(loopOptions);
    return result;
  } finally {
    // Always flush traces, even on error
    await traceRecorder.flush();
  }
}
