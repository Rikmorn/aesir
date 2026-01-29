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
 * Rejection handling (via Temporal signal):
 * -> rePlan -> (generates revised plan, posts to Slack) -> END (awaits another signal)
 *
 * Error handling:
 * - Any phase can transition to "escalated" -> escalate node -> END (waits for human)
 * - Failed phase transitions to "failed" -> END
 *
 * PR Feedback handling (via Temporal signal):
 * -> handleFeedback -> (back to complete or escalated)
 */

import type {
  DevContainerCleanup,
  DevContainerGit,
  DevContainerManager,
} from "@aesir/platform";
import type { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  createCompleteNode,
  createEscalateNode,
  createExecuteNode,
  createHandleFeedbackNode,
  createNotifyNode,
  createPlanNode,
  createPRNode,
  createRePlanNode,
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
  | "rePlan"
  | "execute"
  | "verify"
  | "createPR"
  | "notify"
  | "complete"
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
    case "re_planning":
      return "rePlan";
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
  /** DevContainerCleanup for container cleanup */
  cleanup: DevContainerCleanup;
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
    cleanup,
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

  // Build rePlan node options
  const rePlanOptions: Parameters<typeof createRePlanNode>[0] = {
    slackChannel,
  };
  if (llm !== undefined) {
    rePlanOptions.llm = llm;
  }
  const rePlanNode = createRePlanNode(rePlanOptions);

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
  const completeNode = createCompleteNode({
    cleanup,
    slackChannel,
  });
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
    .addNode("rePlan", rePlanNode)
    .addNode("execute", executeNode)
    .addNode("verify", verifyNode)
    .addNode("createPR", createPR)
    .addNode("notify", notifyNode)
    .addNode("complete", completeNode)
    .addNode("escalate", escalateNode)
    .addNode("handleFeedback", handleFeedback)

    // Entry: receive issue
    .addEdge("__start__", "receiveIssue")

    // After receive: route by phase
    // Includes resume paths (execute, handleFeedback, rePlan, complete) for Temporal re-invocation
    .addConditionalEdges("receiveIssue", routeByPhase, {
      setup: "setup",
      rePlan: "rePlan",
      execute: "execute",
      complete: "complete",
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

    // After rePlan: route by phase
    // rePlan returns awaiting_approval (end) or failed (end)
    .addConditionalEdges("rePlan", routeByPhase, {
      escalate: "escalate",
      end: "__end__",
    })

    // After execute: route by phase
    // createPR added for non-code files that skip verification
    .addConditionalEdges("execute", routeByPhase, {
      verify: "verify",
      createPR: "createPR",
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

    // After complete: end (PR merged, workflow finalized)
    .addEdge("complete", "__end__")

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
