/**
 * Product Agent Module
 *
 * Provides the Product Agent state schema and helpers for gathering
 * requirements through conversation and creating Linear issues.
 *
 * @example
 * ```typescript
 * import {
 *   ProductAgentStateAnnotation,
 *   createProductAgentInitialState,
 *   hasMinimumRequirements,
 * } from './agents/product-agent';
 *
 * // Create initial state for a new conversation
 * const state = createProductAgentInitialState({
 *   channelId: "C12345678",
 *   threadTs: null,
 *   userId: "U12345678",
 * });
 *
 * // Check if we have enough info to create a task
 * if (hasMinimumRequirements(state.requirements)) {
 *   // Ready to create Linear issue
 * }
 * ```
 */

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
