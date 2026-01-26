/**
 * Product Agent Conversation Graph
 *
 * LangGraph StateGraph for requirement gathering conversation flow.
 * Routes between classification, analysis, clarification, confirmation,
 * and task creation nodes.
 *
 * Graph structure:
 * START -> classify -> (route) -> analyze -> (route) -> confirm -> (route) -> createTasks -> END
 *                  |-> clarify -> END (unclear)        |-> clarify -> END      |-> clarify -> END
 *                  |-> END (declined)
 *
 * Key design decisions:
 * - Factory pattern for dependency injection (LLM, LinearClient)
 * - Classification at entry filters non-actionable messages
 * - Confirmation step before task creation for user approval
 * - Optional checkpointer support for conversation persistence
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  analyzeRequirementsNode,
  classifyNode,
  confirmNode,
  createTasksNode,
  generateClarificationNode,
} from "./nodes/index.js";
import {
  type ProductAgentState,
  ProductAgentStateAnnotation,
} from "./state.js";

/**
 * Route destinations after classification
 */
export type AfterClassifyRoute = "analyze" | "clarify" | "end";

/**
 * Route destinations after analysis
 */
export type AfterAnalysisRoute = "clarify" | "confirm";

/**
 * Route destinations after confirmation
 */
export type AfterConfirmRoute = "createTasks" | "clarify";

/**
 * Route function for conditional edges after classification.
 *
 * Determines next step based on phase:
 * - If phase is 'declined' -> end (exit with decline message)
 * - If phase is 'clarifying' -> clarify (unclear, ask for clarification)
 * - Else -> analyze (proceed with gathering)
 *
 * @param state - Current conversation state with phase
 * @returns Routing destination
 */
export function routeAfterClassify(
  state: ProductAgentState,
): AfterClassifyRoute {
  if (state.phase === "declined") {
    return "end";
  }
  if (state.phase === "clarifying") {
    return "clarify";
  }
  // Default: proceed with analysis (gathering phase)
  return "analyze";
}

/**
 * Route function for conditional edges after analysis.
 *
 * Determines next step based on phase:
 * - If phase is 'creating' or 'confirming' -> confirm (ready for user confirmation)
 * - If phase is 'clarifying' -> clarify (need more info)
 * - Default -> clarify (need more info)
 *
 * @param state - Current conversation state with phase
 * @returns Routing destination
 */
export function routeAfterAnalysis(
  state: ProductAgentState,
): AfterAnalysisRoute {
  if (state.phase === "creating" || state.phase === "confirming") {
    return "confirm";
  }
  if (state.phase === "clarifying") {
    return "clarify";
  }
  // Default: need more info
  return "clarify";
}

/**
 * Route function for conditional edges after confirmation.
 *
 * Determines next step based on phase:
 * - If phase is 'creating' -> createTasks (user confirmed)
 * - If phase is 'clarifying' -> clarify (user gave feedback)
 * - Default -> clarify (need more info)
 *
 * @param state - Current conversation state with phase
 * @returns Routing destination
 */
export function routeAfterConfirm(state: ProductAgentState): AfterConfirmRoute {
  if (state.phase === "creating") {
    return "createTasks";
  }
  if (state.phase === "clarifying") {
    return "clarify";
  }
  // Default: need more info
  return "clarify";
}

/**
 * Options for creating the product agent graph
 */
export interface ProductAgentGraphOptions {
  /** LLM instance for all nodes (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Team ID to create issues in (required) */
  teamId: string;
  /** Checkpointer for conversation persistence (optional) */
  checkpointer?: PostgresSaver;
}

/**
 * Create the product agent conversation graph.
 *
 * The graph follows this pattern:
 *
 * ```
 * START -> classify -> [routeAfterClassify]
 *                        |           |           |
 *                        v           v           v
 *                     analyze     clarify       END (declined)
 *                        |           |
 *                        v           v
 *               [routeAfterAnalysis] END
 *                  |           |
 *                  v           v
 *               confirm     clarify
 *                  |           |
 *                  v           v
 *          [routeAfterConfirm] END
 *                  |           |
 *                  v           v
 *            createTasks    clarify
 *                  |           |
 *                  v           v
 *                 END         END
 * ```
 *
 * Note: clarify goes to END so the question is returned to the user.
 * Next user message re-invokes graph with checkpointer preserving state.
 *
 * @param options - Graph options with team ID and optional LLM/checkpointer
 * @returns Compiled StateGraph workflow
 */
export function createProductAgentGraph(options: ProductAgentGraphOptions) {
  const { llm, teamId, checkpointer } = options;

  // Build node options - handle exactOptionalPropertyTypes
  const classifyOptions: Parameters<typeof classifyNode>[0] = {};
  if (llm !== undefined) {
    classifyOptions.llm = llm;
  }

  const analyzeOptions: Parameters<typeof analyzeRequirementsNode>[0] = {};
  if (llm !== undefined) {
    analyzeOptions.llm = llm;
  }

  const clarifyOptions: Parameters<typeof generateClarificationNode>[0] = {};
  if (llm !== undefined) {
    clarifyOptions.llm = llm;
  }

  const confirmOptions: Parameters<typeof confirmNode>[0] = {};
  if (llm !== undefined) {
    confirmOptions.llm = llm;
  }

  const createOptions: Parameters<typeof createTasksNode>[0] = {
    teamId,
  };
  if (llm !== undefined) {
    createOptions.llm = llm;
  }

  // Create nodes with injected dependencies
  const classifyNodeInstance = classifyNode(classifyOptions);
  const analyzeNode = analyzeRequirementsNode(analyzeOptions);
  const clarifyNodeInstance = generateClarificationNode(clarifyOptions);
  const confirmNodeInstance = confirmNode(confirmOptions);
  const createNode = createTasksNode(createOptions);

  // Create the StateGraph
  const graph = new StateGraph(ProductAgentStateAnnotation)
    // Add all nodes
    .addNode("classify", classifyNodeInstance)
    .addNode("analyze", analyzeNode)
    .addNode("clarify", clarifyNodeInstance)
    .addNode("confirm", confirmNodeInstance)
    .addNode("createTasks", createNode)

    // Entry point: start with classification
    .addEdge("__start__", "classify")

    // Conditional routing after classification
    .addConditionalEdges("classify", routeAfterClassify, {
      analyze: "analyze",
      clarify: "clarify",
      end: "__end__",
    })

    // Conditional routing after analysis
    .addConditionalEdges("analyze", routeAfterAnalysis, {
      clarify: "clarify",
      confirm: "confirm",
    })

    // After clarification, end turn - return question to user
    // Next user message will re-invoke graph with checkpointer state
    .addEdge("clarify", "__end__")

    // Conditional routing after confirmation
    .addConditionalEdges("confirm", routeAfterConfirm, {
      createTasks: "createTasks",
      clarify: "clarify",
    })

    // After task creation, workflow is complete
    .addEdge("createTasks", "__end__");

  // Compile with optional checkpointer - handle exactOptionalPropertyTypes
  if (checkpointer !== undefined) {
    return graph.compile({ checkpointer });
  }
  return graph.compile();
}

/**
 * Export type for the compiled graph
 */
export type ProductAgentGraph = ReturnType<typeof createProductAgentGraph>;
