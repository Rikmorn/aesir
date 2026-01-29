/**
 * Product Agent State Schema
 *
 * Defines the state structure for the Product Agent using LangGraph's
 * Annotation API with Zod for type safety.
 *
 * The Product Agent gathers requirements through conversation and creates
 * Linear issues from the gathered information.
 *
 * Key design decisions:
 * - messages use concat reducer for conversation history (LangGraph pattern)
 * - requirements use merge reducer for partial updates
 * - phase tracks conversation stage (gathering → clarifying → confirming → creating)
 * - slackContext enables routing responses back to the right channel/thread
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

/**
 * Issue priority levels for Linear
 */
export const IssuePrioritySchema = z.enum(["urgent", "high", "medium", "low"]);

export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

/**
 * Schema for issue draft (preview before creation)
 */
export const IssueDraftSchema = z.object({
  /** Clear, actionable title */
  title: z.string(),
  /** Detailed description with context */
  description: z.string(),
  /** Specific, testable acceptance criteria */
  acceptanceCriteria: z.array(z.string()),
  /** Priority level */
  priority: IssuePrioritySchema,
  /** Suggested labels (feature, bug, frontend, etc.) */
  labels: z.array(z.string()),
  /** Link back to Slack conversation (optional) */
  slackThreadUrl: z.string().nullable(),
});

export type IssueDraft = z.infer<typeof IssueDraftSchema>;

/**
 * Schema for gathered requirements
 */
export const RequirementsSchema = z.object({
  /** What needs to be built */
  what: z.string().nullable().default(null),
  /** Why it's needed (business value) */
  why: z.string().nullable().default(null),
  /** Who is it for (user persona/role) */
  who: z.string().nullable().default(null),
  /** Acceptance criteria (when is it done) */
  acceptanceCriteria: z.array(z.string()).default([]),
  /** Technical constraints or considerations */
  constraints: z.array(z.string()).default([]),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

/**
 * Default empty requirements
 */
export const DEFAULT_REQUIREMENTS: Requirements = {
  what: null,
  why: null,
  who: null,
  acceptanceCriteria: [],
  constraints: [],
};

/**
 * Classification types for incoming messages
 */
export const ClassificationTypeSchema = z.enum([
  "feature_request", // User wants new functionality built
  "bug_report", // Something is broken or not working
  "question", // User asking for help/information (not requesting work)
  "off_topic", // Not product/development related
  "unclear", // Message is ambiguous, need clarification
]);

export type ClassificationType = z.infer<typeof ClassificationTypeSchema>;

/**
 * Classification confidence levels
 */
export const ClassificationConfidenceSchema = z.enum(["high", "medium", "low"]);

export type ClassificationConfidence = z.infer<
  typeof ClassificationConfidenceSchema
>;

/**
 * Conversation phases
 */
export const ProductAgentPhaseSchema = z.enum([
  "gathering", // Initial requirement gathering
  "clarifying", // Asking follow-up questions
  "confirming", // Confirming with user before creating
  "creating", // Creating Linear issue
  "complete", // Issue created
  "declined", // Non-actionable message (question/off-topic)
]);

export type ProductAgentPhase = z.infer<typeof ProductAgentPhaseSchema>;

/**
 * Slack routing context
 */
export const SlackContextSchema = z.object({
  /** Slack channel ID */
  channelId: z.string(),
  /** Thread timestamp for replies */
  threadTs: z.string().nullable().default(null),
  /** User who initiated the conversation */
  userId: z.string(),
});

export type SlackContext = z.infer<typeof SlackContextSchema>;

/**
 * Created task info
 */
export const CreatedTaskSchema = z.object({
  /** Linear issue UUID */
  id: z.string(),
  /** Linear issue identifier (e.g., "ABC-123") */
  identifier: z.string(),
  /** Issue title */
  title: z.string(),
});

export type CreatedTask = z.infer<typeof CreatedTaskSchema>;

/**
 * Full state schema for validation
 */
export const ProductAgentStateSchema = z.object({
  /** Conversation messages (not validated via Zod, handled by LangGraph) */
  messages: z.array(z.unknown()),
  /** Gathered requirements */
  requirements: RequirementsSchema,
  /** Current conversation phase */
  phase: ProductAgentPhaseSchema,
  /** Slack routing context */
  slackContext: SlackContextSchema.nullable(),
  /** Created Linear issues */
  createdTasks: z.array(CreatedTaskSchema),
  /** Issue draft for confirmation (null until confirming phase) */
  issueDraft: IssueDraftSchema.nullable(),
  /** Whether we're waiting for user confirmation */
  awaitingConfirmation: z.boolean(),
});

/**
 * Reducer for merging partial requirement updates
 */
function requirementsReducer(
  current: Requirements,
  incoming: Partial<Requirements>,
): Requirements {
  return {
    what: incoming.what !== undefined ? incoming.what : current.what,
    why: incoming.why !== undefined ? incoming.why : current.why,
    who: incoming.who !== undefined ? incoming.who : current.who,
    acceptanceCriteria:
      incoming.acceptanceCriteria !== undefined
        ? incoming.acceptanceCriteria
        : current.acceptanceCriteria,
    constraints:
      incoming.constraints !== undefined
        ? incoming.constraints
        : current.constraints,
  };
}

/**
 * Product Agent state definition using LangGraph Annotation API
 *
 * Uses reducers to define how state updates:
 * - messages: concat (append new messages to history)
 * - requirements: merge (partial updates)
 * - phase, slackContext, createdTasks: replace (overwrite)
 */
export const ProductAgentStateAnnotation = Annotation.Root({
  /**
   * Conversation history
   * Uses concat reducer to build up messages over iterations
   */
  messages: Annotation<BaseMessage[]>({
    reducer: (current, incoming) => current.concat(incoming),
    default: () => [],
  }),

  /**
   * Gathered requirements
   * Uses merge reducer to allow partial updates
   */
  requirements: Annotation<Requirements, Partial<Requirements>>({
    reducer: requirementsReducer,
    default: () => ({ ...DEFAULT_REQUIREMENTS }),
  }),

  /**
   * Current conversation phase
   * Controls workflow routing
   */
  phase: Annotation<ProductAgentPhase>({
    reducer: (_current, incoming) => incoming,
    default: () => "gathering" as ProductAgentPhase,
  }),

  /**
   * Slack routing context
   * Used to send responses to the correct channel/thread
   */
  slackContext: Annotation<SlackContext | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Created Linear issues
   * Appended when issues are created
   */
  createdTasks: Annotation<CreatedTask[]>({
    reducer: (current, incoming) => current.concat(incoming),
    default: () => [],
  }),

  /**
   * Message classification type
   * Set by classify node, determines routing
   */
  classification: Annotation<ClassificationType | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Classification confidence level
   * Low confidence triggers clarification
   */
  classificationConfidence: Annotation<ClassificationConfidence | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Issue draft for user confirmation
   * Generated in confirming phase before creating in Linear
   */
  issueDraft: Annotation<IssueDraft | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Whether we're waiting for user confirmation
   * True when draft is ready and awaiting "confirm" or feedback
   */
  awaitingConfirmation: Annotation<boolean>({
    reducer: (_current, incoming) => incoming,
    default: () => false,
  }),
});

/**
 * Type for the product agent state
 */
export type ProductAgentState = typeof ProductAgentStateAnnotation.State;

/**
 * Type for partial state updates
 */
export type ProductAgentStateUpdate = typeof ProductAgentStateAnnotation.Update;

/**
 * Check if requirements have enough info to create an issue
 * At minimum needs what and why
 */
export function hasMinimumRequirements(requirements: Requirements): boolean {
  return requirements.what !== null && requirements.why !== null;
}

/**
 * Create initial state for a product agent conversation
 */
export function createProductAgentInitialState(
  slackContext: SlackContext,
): Partial<ProductAgentState> {
  return {
    messages: [],
    requirements: { ...DEFAULT_REQUIREMENTS },
    phase: "gathering" as ProductAgentPhase,
    slackContext,
    createdTasks: [],
  };
}
