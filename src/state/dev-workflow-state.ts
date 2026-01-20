/**
 * Dev Workflow State Schema
 *
 * Defines the state structure for the Dev Agent workflow using LangGraph's
 * Annotation API with Zod for type safety.
 *
 * Key design decisions:
 * - FileChange schema enables structured multi-file output
 * - testAttempts provides iteration limit for fix loop
 * - status field enables routing decisions in workflow
 * - TestResult imported from sandbox types for consistency
 */

import { Annotation } from "@langchain/langgraph";
import { z } from "zod";
import type { TestResult } from "../sandbox/types.js";

/**
 * Schema for a single file change in the workflow.
 * Used by code generation to produce structured output.
 */
export const FileChangeSchema = z.object({
  path: z.string().describe("Relative file path from project root"),
  content: z.string().describe("Complete file content"),
  operation: z
    .enum(["create", "update", "delete"])
    .describe("File operation type"),
});

export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * Possible workflow statuses
 */
export const DevWorkflowStatusSchema = z.enum([
  "pending",
  "coding",
  "testing",
  "fixing",
  "committing",
  "complete",
  "failed",
]);

export type DevWorkflowStatus = z.infer<typeof DevWorkflowStatusSchema>;

/**
 * Configuration for the dev workflow
 */
export interface DevWorkflowConfig {
  /** Maximum test fix attempts before failing (default: 5) */
  maxTestAttempts: number;
  /** Test command to run (default: ["npm", "test"]) */
  testCommand: string[];
  /** LangGraph recursion limit (default: 50) */
  recursionLimit: number;
  /** Workflow timeout in milliseconds (default: 300000 = 5 min) */
  timeoutMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_DEV_WORKFLOW_CONFIG: DevWorkflowConfig = {
  maxTestAttempts: 5,
  testCommand: ["npm", "test"],
  recursionLimit: 50,
  timeoutMs: 300000,
};

/**
 * Dev workflow state definition using LangGraph Annotation API
 *
 * Uses reducers to define how state updates:
 * - files: replace (overwrite with new file changes)
 * - testResult: replace (overwrite with latest result)
 * - testAttempts: replace (increment on each test run)
 * - status: replace (state machine transitions)
 */
export const DevWorkflowState = Annotation.Root({
  /**
   * Linear task ID (Issue ID) being worked on
   */
  taskId: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "",
  }),

  /**
   * Linear AgentSession ID for emitting activities
   * Different from taskId - this is the session created when work is delegated
   */
  sessionId: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "",
  }),

  /**
   * Task description from Linear
   * Used as input to code generation
   */
  taskDescription: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "",
  }),

  /**
   * Target repository URL (owner/repo format)
   */
  repositoryUrl: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Created feature branch name
   */
  branchName: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Generated/modified files
   * Replaced on each code generation or fix iteration
   */
  files: Annotation<FileChange[]>({
    reducer: (_current, incoming) => incoming,
    default: () => [],
  }),

  /**
   * Latest test result from sandbox
   * null when no tests have been run yet
   */
  testResult: Annotation<TestResult | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * Fix iteration counter
   * Incremented each time tests are run, used to enforce iteration limit
   */
  testAttempts: Annotation<number>({
    reducer: (_current, incoming) => incoming,
    default: () => 0,
  }),

  /**
   * Current workflow status
   * Controls routing decisions in the state machine
   */
  status: Annotation<DevWorkflowStatus>({
    reducer: (_current, incoming) => incoming,
    default: () => "pending" as DevWorkflowStatus,
  }),

  /**
   * Error message if workflow failed
   */
  error: Annotation<string | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),

  /**
   * PR number if a pull request was created
   * Propagated from commitPRNode after PR creation
   */
  prNumber: Annotation<number | null>({
    reducer: (_current, incoming) => incoming,
    default: () => null,
  }),
});

/**
 * Type for the dev workflow state
 */
export type DevWorkflowStateType = typeof DevWorkflowState.State;

/**
 * Type for partial state updates
 */
export type DevWorkflowStateUpdate = typeof DevWorkflowState.Update;

/**
 * Check if the workflow has exceeded the test attempt limit
 */
export function hasExceededTestLimit(
  state: DevWorkflowStateType,
  config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG,
): boolean {
  return state.testAttempts >= config.maxTestAttempts;
}

/**
 * Check if tests passed
 */
export function didTestsPass(state: DevWorkflowStateType): boolean {
  return state.testResult?.passed === true;
}

/**
 * Create initial state for a dev workflow
 */
export function createDevWorkflowInitialState(
  taskId: string,
  sessionId: string,
  taskDescription: string,
  repositoryUrl?: string,
): Partial<DevWorkflowStateType> {
  return {
    taskId,
    sessionId,
    taskDescription,
    repositoryUrl: repositoryUrl ?? null,
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "pending" as DevWorkflowStatus,
    error: null,
    prNumber: null,
  };
}
