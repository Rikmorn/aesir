/**
 * Dev Agent Workflow Graph
 *
 * LangGraph StateGraph for the complete dev-agent workflow.
 *
 * Flow:
 * START -> receiveIssue -> setupContainer -> research -> plan -> requestApproval
 *                                                              (awaits Temporal signal)
 *
 * After approval signal:
 * -> execute -> verify -> createPR -> notify -> END
 *
 * Error handling:
 * - Any phase can transition to "escalated" -> escalate node -> END (waits for human)
 * - Failed phase transitions to "failed" -> END
 *
 * Feedback handling (via Temporal signal):
 * -> handleFeedback -> (back to complete or escalated)
 */

import type { DevContainerGit, DevContainerManager } from "@aesir/platform";
import type { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  createEscalateNode,
  createExecuteNode,
  createHandleFeedbackNode,
  createNotifyNode,
  createPlanNode,
  createPRNode,
  createRequestApprovalNode,
  createResearchNode,
  createSetupContainerNode,
  createVerifyNode,
  receiveIssueNode,
} from "./nodes/index.js";
import {
  type DevAgentPhase,
  type DevAgentState,
  DevAgentStateAnnotation,
} from "./state.js";

/**
 * Route after any node based on phase
 */
export type PhaseRoute =
  | "setup"
  | "research"
  | "plan"
  | "requestApproval"
  | "execute"
  | "verify"
  | "createPR"
  | "notify"
  | "handleFeedback"
  | "escalate"
  | "end";

/**
 * Route function based on state phase.
 *
 * This is the central routing logic that determines the next node
 * based on the current workflow phase. Each node updates the phase,
 * and this function routes to the appropriate next node.
 *
 * @param state - Current dev-agent state with phase
 * @returns Route destination for conditional edges
 */
export function routeByPhase(state: DevAgentState): PhaseRoute {
  const phase: DevAgentPhase = state.phase;

  switch (phase) {
    case "pending":
      return "end"; // Shouldn't happen, but safe default
    case "setup":
      return "setup";
    case "researching":
      return "research";
    case "planning":
      return "plan";
    case "requesting_approval":
      return "requestApproval";
    case "awaiting_approval":
      return "end"; // Graph ends here, Temporal waits for signal
    case "executing":
      return "execute";
    case "verifying":
      return "verify";
    case "creating_pr":
      return "createPR";
    case "complete":
      return "notify";
    case "awaiting_feedback":
      return "end"; // Graph ends here, Temporal waits for feedback signal
    case "addressing_feedback":
      return "handleFeedback";
    case "escalated":
      return "escalate";
    case "failed":
      return "end";
    default: {
      // Exhaustive check - TypeScript will error if a phase is missing
      const _exhaustive: never = phase;
      return "end";
    }
  }
}

/**
 * Graph configuration options
 */
export interface DevAgentGraphOptions {
  /** DevContainerManager for container operations */
  manager: DevContainerManager;
  /** DevContainerGit for git operations */
  git: DevContainerGit;
  /** GitHub repo URL for cloning */
  repoUrl: string;
  /** GitHub token for authentication */
  githubToken: string;
  /** GitHub owner */
  owner: string;
  /** GitHub repo name */
  repo: string;
  /** Base branch (default: main) */
  baseBranch?: string;
  /** Slack channel for notifications */
  slackChannel: string;
  /** Optional LLM instance */
  llm?: ChatAnthropic;
  /** Optional checkpointer for state persistence */
  checkpointer?: PostgresSaver;
}

/**
 * Create the dev-agent workflow graph.
 *
 * The graph handles the happy path flow and error escalation.
 * Temporal workflow wraps this graph and handles:
 * - Approval signals (continue from awaiting_approval)
 * - Feedback signals (continue from awaiting_feedback)
 * - Timeouts (24h container stop, 72h reminder)
 *
 * @param options - Graph configuration with dependencies
 * @returns Compiled StateGraph workflow
 */
export function createDevAgentGraph(options: DevAgentGraphOptions) {
  const {
    manager,
    git,
    repoUrl,
    githubToken,
    owner,
    repo,
    baseBranch = "main",
    slackChannel,
    llm,
    checkpointer,
  } = options;

  // Create node instances with dependencies
  const receiveIssue = receiveIssueNode();

  const setupContainer = createSetupContainerNode({
    manager,
    git,
    repoUrl,
    githubToken,
  });

  // Build research node options - handle exactOptionalPropertyTypes
  const researchOptions: Parameters<typeof createResearchNode>[0] = { manager };
  if (llm !== undefined) {
    researchOptions.llm = llm;
  }
  const researchNode = createResearchNode(researchOptions);

  // Build plan node options
  const planOptions: Parameters<typeof createPlanNode>[0] = {};
  if (llm !== undefined) {
    planOptions.llm = llm;
  }
  const planNode = createPlanNode(planOptions);

  const requestApproval = createRequestApprovalNode({
    slackChannel,
  });

  // Build execute node options
  const executeOptions: Parameters<typeof createExecuteNode>[0] = { manager };
  if (llm !== undefined) {
    executeOptions.llm = llm;
  }
  const executeNode = createExecuteNode(executeOptions);

  const verifyNode = createVerifyNode({ manager });

  const createPR = createPRNode({
    owner,
    repo,
    baseBranch,
  });

  const notifyNode = createNotifyNode();
  const escalateNode = createEscalateNode();

  // Build handleFeedback node options
  const handleFeedbackOptions: Parameters<typeof createHandleFeedbackNode>[0] =
    { manager };
  if (llm !== undefined) {
    handleFeedbackOptions.llm = llm;
  }
  const handleFeedback = createHandleFeedbackNode(handleFeedbackOptions);

  // Build the graph
  const graph = new StateGraph(DevAgentStateAnnotation)
    // Add all nodes
    .addNode("receiveIssue", receiveIssue)
    .addNode("setup", setupContainer)
    .addNode("research", researchNode)
    .addNode("plan", planNode)
    .addNode("requestApproval", requestApproval)
    .addNode("execute", executeNode)
    .addNode("verify", verifyNode)
    .addNode("createPR", createPR)
    .addNode("notify", notifyNode)
    .addNode("escalate", escalateNode)
    .addNode("handleFeedback", handleFeedback)

    // Entry: receive issue
    .addEdge("__start__", "receiveIssue")

    // After receive: route by phase
    // Includes resume paths (execute, handleFeedback) for Temporal re-invocation
    .addConditionalEdges("receiveIssue", routeByPhase, {
      setup: "setup",
      execute: "execute",
      handleFeedback: "handleFeedback",
      escalate: "escalate",
      end: "__end__",
    })

    // After setup: route by phase
    .addConditionalEdges("setup", routeByPhase, {
      research: "research",
      escalate: "escalate",
      end: "__end__",
    })

    // After research: route by phase
    .addConditionalEdges("research", routeByPhase, {
      plan: "plan",
      escalate: "escalate",
      end: "__end__",
    })

    // After plan: route by phase
    .addConditionalEdges("plan", routeByPhase, {
      requestApproval: "requestApproval",
      escalate: "escalate",
      end: "__end__",
    })

    // After requestApproval: route by phase
    // In practice, always ends here (awaiting_approval -> end)
    // But we include execute path for graph validation (Temporal re-invokes with executing phase)
    .addConditionalEdges("requestApproval", routeByPhase, {
      execute: "execute",
      escalate: "escalate",
      end: "__end__",
    })

    // After execute: route by phase
    .addConditionalEdges("execute", routeByPhase, {
      verify: "verify",
      escalate: "escalate",
      end: "__end__",
    })

    // After verify: route by phase
    .addConditionalEdges("verify", routeByPhase, {
      createPR: "createPR",
      escalate: "escalate",
      end: "__end__",
    })

    // After createPR: route by phase
    .addConditionalEdges("createPR", routeByPhase, {
      notify: "notify",
      escalate: "escalate",
      end: "__end__",
    })

    // After notify: end
    .addEdge("notify", "__end__")

    // After escalate: end (waits for human)
    .addEdge("escalate", "__end__")

    // After handleFeedback: route by phase
    .addConditionalEdges("handleFeedback", routeByPhase, {
      notify: "notify",
      escalate: "escalate",
      end: "__end__",
    });

  // Compile with optional checkpointer - handle exactOptionalPropertyTypes
  if (checkpointer !== undefined) {
    return graph.compile({ checkpointer });
  }
  return graph.compile();
}

/**
 * Export type for compiled graph
 */
export type DevAgentGraph = ReturnType<typeof createDevAgentGraph>;
