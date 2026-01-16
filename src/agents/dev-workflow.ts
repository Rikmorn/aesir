/**
 * Dev Workflow StateGraph Definition
 *
 * Implements the Generator-Critic pattern using LangGraph's StateGraph.
 * The workflow cycles: generate → test → (pass → commit, fail → fix → test).
 *
 * This file defines:
 * - routeAfterTest: Routing function for conditional edges
 * - devWorkflow: StateGraph workflow definition
 *
 * Key design decisions:
 * - Uses Annotation.Root from state schema for type-safe state
 * - Conditional edges based on test result and iteration count
 * - Separate commit and fail end states for clarity
 * - Core loop ready for integration nodes (task pickup, branch, commit) in Plan 05-03
 */

import { StateGraph, END } from "@langchain/langgraph";
import {
  DevWorkflowState,
  DevWorkflowConfig,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowStateType,
} from "../state/dev-workflow-state.js";
import { generateCodeNode } from "./nodes/generate-code.js";
import { createRunTestsNode } from "./nodes/run-tests.js";
import { fixCodeNode } from "./nodes/fix-code.js";
import type { Sandbox } from "../sandbox/types.js";

/**
 * Routing result after test execution
 */
export type AfterTestRoute = "fix_code" | "commit" | "fail";

/**
 * Route function for conditional edges after test execution.
 *
 * Determines next step based on:
 * - If tests passed → commit
 * - If max iterations exceeded → fail
 * - Otherwise → fix_code and retry
 *
 * @param state - Current workflow state with test result
 * @param config - Workflow configuration with maxTestAttempts
 * @returns Routing destination
 */
export function routeAfterTest(
  state: DevWorkflowStateType,
  config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG
): AfterTestRoute {
  // Tests passed - proceed to commit
  if (state.testResult?.passed) {
    return "commit";
  }

  // Max iterations exceeded - fail the workflow
  if (state.testAttempts >= config.maxTestAttempts) {
    return "fail";
  }

  // Tests failed, still have attempts - try to fix
  return "fix_code";
}

/**
 * Options for creating the dev workflow
 */
export interface DevWorkflowOptions {
  /** Sandbox instance for test execution */
  sandbox: Sandbox;
  /** Workflow configuration */
  config?: DevWorkflowConfig;
}

/**
 * Create the dev workflow StateGraph.
 *
 * The workflow follows this pattern:
 *
 * ```
 * START → generate_code → run_tests
 *                           ↓
 *                    [routeAfterTest]
 *                    /       |        \
 *                 commit   fail    fix_code
 *                   ↓        ↓         ↓
 *                  END      END   run_tests (loop back)
 * ```
 *
 * Note: This creates the core generate→test→fix loop.
 * Task pickup, branch creation, and actual commit nodes will be added in Plan 05-03.
 *
 * @param options - Workflow options with sandbox and config
 * @returns Compiled StateGraph workflow
 */
export function createDevWorkflow(options: DevWorkflowOptions) {
  const { sandbox, config = DEFAULT_DEV_WORKFLOW_CONFIG } = options;

  // Create the run tests node with injected sandbox
  const runTestsNode = createRunTestsNode(sandbox);

  // Wrap nodes to only take state (LangGraph nodes must have single state parameter)
  const generateCodeWrapper = async (state: DevWorkflowStateType) => {
    return generateCodeNode(state);
  };

  const runTestsWrapper = async (state: DevWorkflowStateType) => {
    return runTestsNode(state, config);
  };

  const fixCodeWrapper = async (state: DevWorkflowStateType) => {
    return fixCodeNode(state);
  };

  // Create the StateGraph
  const workflow = new StateGraph(DevWorkflowState)
    // Add nodes
    .addNode("generate_code", generateCodeWrapper)
    .addNode("run_tests", runTestsWrapper)
    .addNode("fix_code", fixCodeWrapper)

    // Entry point: start with code generation
    .addEdge("__start__", "generate_code")

    // After generation, run tests
    .addEdge("generate_code", "run_tests")

    // Conditional routing after tests
    .addConditionalEdges(
      "run_tests",
      // Route function with config bound
      (state: DevWorkflowStateType) => routeAfterTest(state, config),
      {
        fix_code: "fix_code",
        commit: END,
        fail: END,
      }
    )

    // After fix, run tests again (the loop)
    .addEdge("fix_code", "run_tests");

  return workflow.compile();
}

/**
 * Export type for the compiled workflow
 */
export type DevWorkflow = ReturnType<typeof createDevWorkflow>;
