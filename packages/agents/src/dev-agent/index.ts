/**
 * Dev Agent Module
 *
 * LangGraph-based workflow for automated development:
 * Linear issue -> Research -> Plan -> Execute -> PR
 *
 * Exports:
 * - State types and schemas for workflow data structures
 * - Graph creator for building the LangGraph workflow
 * - Prompts for testing/customization
 * - Node factories for testing and composition
 */

// State - types, schemas, and utilities
export {
  createDevAgentInitialState,
  DevAgentStateAnnotation,
  type DevAgentPhase,
  type DevAgentState,
  type DevAgentStateUpdate,
  DevAgentStateSchema,
  type ExecutionPlan,
  type ExecutionStep,
  ExecutionPlanSchema,
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

// Graph - workflow creation and types
export {
  createDevAgentGraph,
  type DevAgentGraph,
  type DevAgentGraphOptions,
  type PhaseRoute,
  routeByPhase,
} from "./graph.js";

// Prompts - for testing and customization
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

// Nodes - for testing and custom composition
export {
  type CreatePRNodeDeps,
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
  type ExecuteNodeDeps,
  type HandleFeedbackNodeDeps,
  type PlanNodeDeps,
  receiveIssueNode,
  type RequestApprovalNodeDeps,
  type ResearchNodeDeps,
  type SetupContainerNodeDeps,
  type VerifyNodeDeps,
} from "./nodes/index.js";
