/**
 * Dev Workflow StateGraph Definition
 *
 * Implements the complete Dev Agent workflow using LangGraph's StateGraph.
 * The workflow cycles through: pickup_task → create_branch → generate → test → (pass → commit_pr, fail → fix → test).
 *
 * This file defines:
 * - routeAfterTest: Routing function for conditional edges
 * - createDevWorkflow: StateGraph workflow factory with full Linear/GitHub integration
 *
 * Key design decisions:
 * - Factory pattern for dependency injection (Linear, GitHub, Sandbox)
 * - Conditional edges based on test result and iteration count
 * - Complete workflow from task pickup to PR creation
 */

import {
  DEFAULT_DEV_WORKFLOW_CONFIG,
  type DevWorkflowConfig,
  DevWorkflowState,
  type DevWorkflowStateType,
  type Sandbox,
} from "@aesir/common";
import { END, StateGraph } from "@langchain/langgraph";
import type { LinearClient } from "@linear/sdk";
import type { Octokit } from "@octokit/rest";
import { createCommitPRNode } from "./nodes/commit-pr.js";
import { createBranchNode } from "./nodes/create-branch.js";
import { fixCodeNode } from "./nodes/fix-code.js";
import { generateCodeNode } from "./nodes/generate-code.js";
import { createPickupTaskNode } from "./nodes/pickup-task.js";
import { createRunTestsNode } from "./nodes/run-tests.js";

/**
 * Routing result after test execution
 */
export type AfterTestRoute = "fix_code" | "commit_pr" | "fail";

/**
 * Route function for conditional edges after test execution.
 *
 * Determines next step based on:
 * - If tests passed → commit_pr
 * - If max iterations exceeded → fail
 * - Otherwise → fix_code and retry
 *
 * @param state - Current workflow state with test result
 * @param config - Workflow configuration with maxTestAttempts
 * @returns Routing destination
 */
export function routeAfterTest(
  state: DevWorkflowStateType,
  config: DevWorkflowConfig = DEFAULT_DEV_WORKFLOW_CONFIG,
): AfterTestRoute {
  // Tests passed - proceed to commit
  if (state.testResult?.passed) {
    return "commit_pr";
  }

  // Max iterations exceeded - fail the workflow
  if (state.testAttempts >= config.maxTestAttempts) {
    return "fail";
  }

  // Tests failed, still have attempts - try to fix
  return "fix_code";
}

/**
 * GitHub repository configuration for dev workflow
 */
export interface GitHubConfig {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Base branch (default: 'main') */
  baseBranch: string;
}

/**
 * Dependencies required by the dev workflow
 */
export interface DevWorkflowDependencies {
  /** Authenticated Linear client for task management */
  linearClient: LinearClient;
  /** Authenticated Octokit for GitHub operations */
  octokit: Octokit;
  /** Sandbox instance for code execution */
  sandbox: Sandbox;
  /** GitHub repository configuration */
  githubConfig: GitHubConfig;
}

/**
 * Options for creating the dev workflow
 */
export interface DevWorkflowOptions {
  /** All external dependencies */
  deps: DevWorkflowDependencies;
  /** Workflow configuration */
  config?: DevWorkflowConfig;
}

/**
 * Create the dev workflow StateGraph.
 *
 * The workflow follows this pattern:
 *
 * ```
 * START → pickup_task → create_branch → generate_code → run_tests
 *                                                          ↓
 *                                                   [routeAfterTest]
 *                                                   /       |        \
 *                                              commit_pr   fail    fix_code
 *                                                 ↓        ↓         ↓
 *                                                END      END   run_tests (loop back)
 * ```
 *
 * @param options - Workflow options with dependencies and config
 * @returns Compiled StateGraph workflow
 */
export function createDevWorkflow(options: DevWorkflowOptions) {
  const { deps, config = DEFAULT_DEV_WORKFLOW_CONFIG } = options;

  // Create nodes with injected dependencies
  const pickupTaskNode = createPickupTaskNode(deps.linearClient);
  const createBranchNodeFn = createBranchNode(deps.octokit, {
    owner: deps.githubConfig.owner,
    repo: deps.githubConfig.repo,
    baseBranch: deps.githubConfig.baseBranch,
  });
  const runTestsNode = createRunTestsNode(deps.sandbox);
  const commitPRNode = createCommitPRNode(deps.octokit, deps.linearClient, {
    owner: deps.githubConfig.owner,
    repo: deps.githubConfig.repo,
    baseBranch: deps.githubConfig.baseBranch,
  });

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
    // Add all nodes
    .addNode("pickup_task", pickupTaskNode)
    .addNode("create_branch", createBranchNodeFn)
    .addNode("generate_code", generateCodeWrapper)
    .addNode("run_tests", runTestsWrapper)
    .addNode("fix_code", fixCodeWrapper)
    .addNode("commit_pr", commitPRNode)

    // Entry point: start with task pickup from Linear
    .addEdge("__start__", "pickup_task")

    // After pickup, create the feature branch
    .addEdge("pickup_task", "create_branch")

    // After branch creation, generate code
    .addEdge("create_branch", "generate_code")

    // After generation, run tests
    .addEdge("generate_code", "run_tests")

    // Conditional routing after tests
    .addConditionalEdges(
      "run_tests",
      // Route function with config bound
      (state: DevWorkflowStateType) => routeAfterTest(state, config),
      {
        fix_code: "fix_code",
        commit_pr: "commit_pr",
        fail: END,
      },
    )

    // After fix, run tests again (the loop)
    .addEdge("fix_code", "run_tests")

    // After commit/PR, workflow is complete
    .addEdge("commit_pr", END);

  return workflow.compile();
}

/**
 * Export type for the compiled workflow
 */
export type DevWorkflow = ReturnType<typeof createDevWorkflow>;
