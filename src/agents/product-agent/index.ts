/**
 * Product Agent Module
 *
 * Provides the Product Agent conversation graph for gathering requirements
 * through natural dialogue and creating Linear issues.
 *
 * @example
 * ```typescript
 * import {
 *   createProductAgentGraph,
 *   ProductAgentStateAnnotation,
 *   createProductAgentInitialState,
 * } from './agents/product-agent';
 *
 * // Create the conversation graph
 * const graph = createProductAgentGraph({
 *   linearClient,
 *   teamId: "team-123",
 * });
 *
 * // Create initial state for a new conversation
 * const state = createProductAgentInitialState({
 *   channelId: "C12345678",
 *   threadTs: null,
 *   userId: "U12345678",
 * });
 *
 * // Invoke the graph
 * const result = await graph.invoke(state);
 * ```
 */

// Graph factory and routing
export {
  createProductAgentGraph,
  routeAfterAnalysis,
  type ProductAgentGraph,
  type ProductAgentGraphOptions,
  type AfterAnalysisRoute,
} from "./graph.js";

// Conversation nodes
export {
  analyzeRequirementsNode,
  generateClarificationNode,
  createTasksNode,
  RequirementAnalysisSchema,
  TaskListSchema,
  type RequirementAnalysis,
  type TaskList,
  type GeneratedTask,
  type AnalyzeRequirementsNodeOptions,
  type GenerateClarificationNodeOptions,
  type CreateTasksNodeOptions,
} from "./nodes/index.js";

// Prompts
export {
  ANALYZE_REQUIREMENTS_PROMPT,
  GENERATE_CLARIFICATION_PROMPT,
  CREATE_TASKS_PROMPT,
} from "./prompts.js";

// State schema and types
export {
  ProductAgentStateAnnotation,
  hasMinimumRequirements,
  createProductAgentInitialState,
  DEFAULT_REQUIREMENTS,
  type ProductAgentState,
  type ProductAgentStateUpdate,
  type ProductAgentPhase,
  type Requirements,
  type SlackContext,
  type CreatedTask,
} from "./state.js";

// Zod schemas for validation
export {
  RequirementsSchema,
  ProductAgentPhaseSchema,
  SlackContextSchema,
  CreatedTaskSchema,
  ProductAgentStateSchema,
} from "./state.js";

// Runner for Slack integration
export {
  runProductAgent,
  type RunProductAgentInput,
  type RunProductAgentOutput,
  type RunProductAgentOptions,
} from "./runner.js";
