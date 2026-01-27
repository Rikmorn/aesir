/**
 * Dev Agent State Schema
 *
 * Defines the state structure for the Dev Agent workflow using LangGraph's
 * Annotation API with Zod for type safety.
 *
 * The Dev Agent receives Linear issues with "agent-ready" labels and produces
 * mergeable PRs through research, planning, execution, and feedback handling.
 *
 * Key design decisions:
 * - ResearchContext captures codebase understanding (files, patterns, risks)
 * - ExecutionPlan includes confidence level for approval quality gate
 * - Phase tracks workflow stage through research -> approval -> execution -> PR
 * - Slack context enables notification updates via message timestamps
 */

import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

/**
 * Schema for a relevant file discovered during research
 */
export const RelevantFileSchema = z.object({
  /** File path relative to repository root */
  path: z.string(),
  /** Why this file is relevant to the task */
  purpose: z.string(),
  /** Code patterns found in this file that should be followed */
  patterns: z.array(z.string()),
});

export type RelevantFile = z.infer<typeof RelevantFileSchema>;

/**
 * Research context artifact from codebase exploration.
 * Captures understanding needed for planning phase.
 */
export const ResearchContextSchema = z.object({
  /** Files relevant to implementing this task */
  relevantFiles: z.array(RelevantFileSchema),
  /** Existing patterns in the codebase to follow */
  existingPatterns: z.array(z.string()),
  /** Dependencies that may be affected or needed */
  dependencies: z.array(z.string()),
  /** Potential risks or concerns identified */
  risks: z.array(z.string()),
  /** Things we still don't know (explicit acknowledgment of gaps) */
  unknowns: z.array(z.string()),
});

export type ResearchContext = z.infer<typeof ResearchContextSchema>;

/**
 * Schema for a single execution step in the plan
 */
export const ExecutionStepSchema = z.object({
  /** What this step accomplishes */
  description: z.string(),
  /** Files to create or modify */
  files: z.array(z.string()),
  /** How this step will be tested */
  testStrategy: z.string(),
});

export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

/**
 * Execution plan artifact from planning phase.
 * Includes confidence level for quality gate in approval.
 */
export const ExecutionPlanSchema = z.object({
  /** Brief title for the plan */
  title: z.string(),
  /** Summary of the implementation approach */
  summary: z.string(),
  /** Confidence level affects approval decision */
  confidence: z.enum(["high", "medium", "low"]),
  /** Explanation of why confidence is at this level */
  confidenceReasoning: z.string(),
  /** Ordered steps to implement the feature */
  steps: z.array(ExecutionStepSchema),
  /** Estimated scope of changes (e.g., "3 files, ~200 lines") */
  estimatedChanges: z.string(),
  /** Known risks that reviewer should consider */
  risks: z.array(z.string()),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/**
 * Linear issue context from webhook payload.
 * Contains the task information needed to start work.
 */
export const LinearIssueContextSchema = z.object({
  /** Linear issue UUID */
  id: z.string(),
  /** Human-readable identifier (e.g., "ABC-123") */
  identifier: z.string(),
  /** Issue title */
  title: z.string(),
  /** Issue description (may be null if not provided) */
  description: z.string().nullable(),
  /** Priority level (0-4, where 0 is no priority) */
  priority: z.number().nullable(),
  /** Label names attached to the issue */
  labels: z.array(z.string()),
});

export type LinearIssueContext = z.infer<typeof LinearIssueContextSchema>;

/**
 * Dev agent workflow phases.
 * Tracks progress through the full development lifecycle.
 */
export const DevAgentPhaseSchema = z.enum([
  /** Initial state before any work begins */
  "pending",
  /** Setting up container and cloning repository */
  "setup",
  /** Exploring codebase to understand context */
  "researching",
  /** Creating execution plan from research */
  "planning",
  /** Requesting human approval (posting to Slack/Linear) */
  "requesting_approval",
  /** Waiting for human to approve the plan */
  "awaiting_approval",
  /** Revising plan based on rejection feedback */
  "re_planning",
  /** Implementing the approved plan */
  "executing",
  /** Running full test suite and validation */
  "verifying",
  /** Creating pull request with changes */
  "creating_pr",
  /** Waiting for PR review feedback */
  "awaiting_feedback",
  /** Making changes based on review feedback */
  "addressing_feedback",
  /** Workflow completed successfully */
  "complete",
  /** Workflow failed (check errorMessage) */
  "failed",
  /** Issue escalated to human (too complex or repeated failures) */
  "escalated",
]);

export type DevAgentPhase = z.infer<typeof DevAgentPhaseSchema>;

/**
 * Approval status for the execution plan
 */
export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "changes_requested",
]);

export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/**
 * Schema for a single file change during execution
 */
export const FileChangeSchema = z.object({
  /** Relative file path from project root */
  path: z.string(),
  /** Complete file content */
  content: z.string(),
  /** Type of operation */
  operation: z.enum(["create", "update", "delete"]),
});

export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * Full state schema for validation
 */
export const DevAgentStateSchema = z.object({
  taskId: z.string(),
  issue: LinearIssueContextSchema.nullable(),
  containerId: z.string().nullable(),
  branchName: z.string().nullable(),
  phase: DevAgentPhaseSchema,
  researchContext: ResearchContextSchema.nullable(),
  executionPlan: ExecutionPlanSchema.nullable(),
  approvalStatus: ApprovalStatusSchema,
  approvalFeedback: z.string().nullable(),
  prNumber: z.number().nullable(),
  prUrl: z.string().nullable(),
  prFeedback: z.string().nullable(),
  testAttempts: z.number(),
  errorMessage: z.string().nullable(),
  slackChannel: z.string().nullable(),
  slackMessageTs: z.string().nullable(),
  files: z.array(FileChangeSchema),
});

/**
 * Dev Agent state definition using LangGraph Annotation API
 *
 * Uses reducers to define how state updates:
 * - Most fields use replace reducer (overwrite)
 * - testAttempts can use increment via special handling
 * - files replaces entire array (not concat)
 */
export const DevAgentStateAnnotation = Annotation.Root({
  /**
   * Linear task ID (Issue UUID) being worked on
   * Used as primary identifier throughout workflow
   */
  taskId: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "",
  }),

  /**
   * Linear issue context from webhook
   * Contains title, description, labels needed for research
   */
  issue: Annotation<LinearIssueContext | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Dev container ID for shell execution
   * Created during setup phase, used throughout execution
   */
  containerId: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Feature branch name created for this task
   * Format: feature/{issueIdentifier}
   */
  branchName: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Current workflow phase
   * Controls routing and determines which nodes can execute
   */
  phase: Annotation<DevAgentPhase>({
    reducer: (_current, incoming) => incoming,
    default: () => "pending" as DevAgentPhase,
  }),

  /**
   * Research context from codebase exploration
   * Populated by research node, consumed by planning node
   */
  researchContext: Annotation<ResearchContext | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Execution plan from planning phase
   * Includes confidence level for approval quality gate
   */
  executionPlan: Annotation<ExecutionPlan | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Plan approval status
   * Updated via Temporal signal from Linear comment or Slack button
   */
  approvalStatus: Annotation<ApprovalStatus>({
    reducer: (_current, incoming) => incoming,
    default: () => "pending" as ApprovalStatus,
  }),

  /**
   * Feedback from approval rejection or change request
   * Used to revise plan if changes_requested
   */
  approvalFeedback: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * PR number if created
   */
  prNumber: Annotation<number | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * PR URL for linking in notifications
   */
  prUrl: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Feedback from PR review
   * Used to address changes in addressing_feedback phase
   */
  prFeedback: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Number of test fix attempts
   * Used to enforce retry limit (3 attempts before escalate)
   */
  testAttempts: Annotation<number>({
    reducer: (_current, incoming) => incoming,
    default: () => 0,
  }),

  /**
   * Error message if workflow failed
   * Populated when phase transitions to "failed"
   */
  errorMessage: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Slack channel for notifications
   * Configured via environment or per-team settings
   */
  slackChannel: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Slack message timestamp for update_message
   * Enables updating existing notification rather than posting new
   */
  slackMessageTs: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Generated/modified files during execution
   * Replaced on each code generation or fix iteration
   */
  files: Annotation<FileChange[]>({
    reducer: (_current, incoming) => incoming,
    default: () => [],
  }),
});

/**
 * Type for the dev agent state
 */
export type DevAgentState = typeof DevAgentStateAnnotation.State;

/**
 * Type for partial state updates
 */
export type DevAgentStateUpdate = typeof DevAgentStateAnnotation.Update;

/**
 * Maximum test fix attempts before escalation (context decision)
 */
export const MAX_TEST_ATTEMPTS = 3;

/**
 * Check if test attempts have exceeded the limit
 */
export function hasExceededTestLimit(state: DevAgentState): boolean {
  return state.testAttempts >= MAX_TEST_ATTEMPTS;
}

/**
 * Create initial state for a dev agent workflow
 */
export function createDevAgentInitialState(
  taskId: string,
  issue: LinearIssueContext,
  slackChannel: string | null,
): Partial<DevAgentState> {
  return {
    taskId,
    issue,
    containerId: null,
    branchName: null,
    phase: "pending" as DevAgentPhase,
    researchContext: null,
    executionPlan: null,
    approvalStatus: "pending" as ApprovalStatus,
    approvalFeedback: null,
    prNumber: null,
    prUrl: null,
    prFeedback: null,
    testAttempts: 0,
    errorMessage: null,
    slackChannel,
    slackMessageTs: null,
    files: [],
  };
}

/**
 * Check if the workflow is in an actionable phase
 * (not waiting for human input or already terminal)
 */
export function isActionablePhase(phase: DevAgentPhase): boolean {
  return ![
    "awaiting_approval",
    "awaiting_feedback",
    "complete",
    "failed",
    "escalated",
  ].includes(phase);
}

/**
 * Check if the workflow has reached a terminal state
 */
export function isTerminalPhase(phase: DevAgentPhase): boolean {
  return ["complete", "failed", "escalated"].includes(phase);
}
