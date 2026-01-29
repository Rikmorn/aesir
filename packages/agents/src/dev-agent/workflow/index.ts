/**
 * Dev Agent HITL Workflow
 *
 * LangGraph StateGraph for the complete dev-agent workflow with
 * Temporal-orchestrated human-in-the-loop approval flows.
 *
 * Flow: receive issue -> research -> plan -> approval -> execute -> verify -> PR
 */

// Graph factory and routing
export {
  createDevAgentGraph,
  type DevAgentGraph,
  type DevAgentGraphOptions,
  type PhaseRoute,
  routeByPhase,
} from "./graph.js";
// Nodes
export {
  type CompleteNodeDeps,
  type CreatePRNodeDeps,
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
  type ExecuteNodeDeps,
  type HandleFeedbackNodeDeps,
  type PlanNodeDeps,
  type RePlanNodeDeps,
  type RequestApprovalNodeDeps,
  type ResearchNodeDeps,
  receiveIssueNode,
  type SetupContainerNodeDeps,
  type VerifyNodeDeps,
} from "./nodes/index.js";
// Prompts
export {
  buildFileWritePrompt,
  buildPlanningPrompt,
  buildPrFeedbackPrompt,
  buildResearchPrompt,
  buildTestFixPrompt,
  FILE_WRITE_SYSTEM_PROMPT,
  formatPlanAsMarkdown,
  PLANNING_SYSTEM_PROMPT,
  PR_FEEDBACK_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  TEST_FIX_SYSTEM_PROMPT,
} from "./prompts.js";
// State
export {
  createDevAgentInitialState,
  type DevAgentPhase,
  type DevAgentState,
  DevAgentStateAnnotation,
  DevAgentStateSchema,
  type DevAgentStateUpdate,
  type ExecutionPlan,
  ExecutionPlanSchema,
  type ExecutionStep,
  ExecutionStepSchema,
  type FileChange,
  FileChangeSchema,
  hasExceededTestLimit,
  isActionablePhase,
  isTerminalPhase,
  type LinearIssueContext,
  LinearIssueContextSchema,
  MAX_TEST_ATTEMPTS,
  type RelevantFile,
  RelevantFileSchema,
  type ResearchContext,
  ResearchContextSchema,
} from "./state.js";
