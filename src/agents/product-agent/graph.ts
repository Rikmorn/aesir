/**
 * Product Agent Conversation Graph
 *
 * LangGraph StateGraph for requirement gathering conversation flow.
 * Routes between analysis, clarification, and task creation nodes.
 *
 * Graph structure:
 * START -> analyze -> (route) -> clarify -> END (return question to user)
 *                            -> createTasks -> END
 *
 * Key design decisions:
 * - Factory pattern for dependency injection (LLM, LinearClient)
 * - Conditional routing based on phase after analysis
 * - Optional checkpointer support for conversation persistence
 */

import { StateGraph } from "@langchain/langgraph";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { LinearClient } from "@linear/sdk";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  ProductAgentStateAnnotation,
  type ProductAgentState,
} from "./state.js";
import {
  analyzeRequirementsNode,
  generateClarificationNode,
  createTasksNode,
} from "./nodes/index.js";

/**
 * Route destinations after analysis
 */
export type AfterAnalysisRoute = "clarify" | "createTasks";

/**
 * Route function for conditional edges after analysis.
 *
 * Determines next step based on phase:
 * - If phase is 'creating' or 'complete' -> createTasks
 * - If phase is 'clarifying' -> clarify
 * - Default -> clarify (need more info)
 *
 * @param state - Current conversation state with phase
 * @returns Routing destination
 */
export function routeAfterAnalysis(state: ProductAgentState): AfterAnalysisRoute {
  if (state.phase === "complete" || state.phase === "creating") {
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
  /** LinearClient for creating issues (required) */
  linearClient: LinearClient;
  /** Team ID to create issues in (required) */
  teamId: string;
  /** Checkpointer for conversation persistence (optional) */
  checkpointer?: SqliteSaver;
}

/**
 * Create the product agent conversation graph.
 *
 * The graph follows this pattern:
 *
 * ```
 * START -> analyze -> [routeAfterAnalysis]
 *                        |           |
 *                        v           v
 *                     clarify    createTasks
 *                        |           |
 *                        v           v
 *                       END         END
 * ```
 *
 * Note: clarify goes to END so the question is returned to the user.
 * Next user message re-invokes graph with checkpointer preserving state.
 *
 * @param options - Graph options with dependencies
 * @returns Compiled StateGraph workflow
 */
export function createProductAgentGraph(options: ProductAgentGraphOptions) {
  const { llm, linearClient, teamId, checkpointer } = options;

  // Build node options - handle exactOptionalPropertyTypes
  const analyzeOptions: Parameters<typeof analyzeRequirementsNode>[0] = {};
  if (llm !== undefined) {
    analyzeOptions.llm = llm;
  }

  const clarifyOptions: Parameters<typeof generateClarificationNode>[0] = {};
  if (llm !== undefined) {
    clarifyOptions.llm = llm;
  }

  const createOptions: Parameters<typeof createTasksNode>[0] = {
    linearClient,
    teamId,
  };
  if (llm !== undefined) {
    createOptions.llm = llm;
  }

  // Create nodes with injected dependencies
  const analyzeNode = analyzeRequirementsNode(analyzeOptions);
  const clarifyNode = generateClarificationNode(clarifyOptions);
  const createNode = createTasksNode(createOptions);

  // Create the StateGraph
  const graph = new StateGraph(ProductAgentStateAnnotation)
    // Add all nodes
    .addNode("analyze", analyzeNode)
    .addNode("clarify", clarifyNode)
    .addNode("createTasks", createNode)

    // Entry point: start with analysis
    .addEdge("__start__", "analyze")

    // Conditional routing after analysis
    .addConditionalEdges("analyze", routeAfterAnalysis, {
      clarify: "clarify",
      createTasks: "createTasks",
    })

    // After clarification, end turn - return question to user
    // Next user message will re-invoke graph with checkpointer state
    .addEdge("clarify", "__end__")

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
