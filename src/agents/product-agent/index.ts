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
  type AfterAnalysisRoute,
  createProductAgentGraph,
  type ProductAgentGraph,
  type ProductAgentGraphOptions,
  routeAfterAnalysis,
} from "./graph.js";

// Conversation nodes
export {
  type AnalyzeRequirementsNodeOptions,
  analyzeRequirementsNode,
  type CreateTasksNodeOptions,
  createTasksNode,
  type GenerateClarificationNodeOptions,
  type GeneratedTask,
  generateClarificationNode,
  type RequirementAnalysis,
  RequirementAnalysisSchema,
  type TaskList,
  TaskListSchema,
} from "./nodes/index.js";

// Prompts
export {
  ANALYZE_REQUIREMENTS_PROMPT,
  CREATE_TASKS_PROMPT,
  GENERATE_CLARIFICATION_PROMPT,
} from "./prompts.js";
// Runner for Slack integration
export {
  type RunProductAgentInput,
  type RunProductAgentOptions,
  type RunProductAgentOutput,
  runProductAgent,
} from "./runner.js";
// State schema and types
// Zod schemas for validation
export {
  type CreatedTask,
  CreatedTaskSchema,
  createProductAgentInitialState,
  DEFAULT_REQUIREMENTS,
  hasMinimumRequirements,
  type ProductAgentPhase,
  ProductAgentPhaseSchema,
  type ProductAgentState,
  ProductAgentStateAnnotation,
  ProductAgentStateSchema,
  type ProductAgentStateUpdate,
  type Requirements,
  RequirementsSchema,
  type SlackContext,
  SlackContextSchema,
} from "./state.js";
