/**
 * Agent Toolkits
 *
 * Per-agent toolkit factory functions that compose codebase, integration,
 * and coordination tools into role-specific tool sets.
 *
 * Principle: Sub-agents (researcher, coder, tester) get only codebase tools.
 * The orchestrator gets full access: codebase + integration + coordination.
 * The product agent gets a minimal integration-only tool set (no codebase tools).
 *
 * Sub-agent system prompts are imported from the dev-agent orchestrator module
 * (packages/agents/src/dev-agent/orchestrator/system-prompts.ts) which defines
 * production-quality prompts with structured XML sections.
 *
 * Tool counts:
 * - Researcher: 4 (read_file, search_codebase, list_directory, run_command)
 * - Coder: 4 (read_file, write_file, search_codebase, run_command)
 * - Tester: 3 (read_file, search_codebase, run_command)
 * - Orchestrator: 13 (3 codebase + 2 coordination + 8 integration)
 * - Product Agent: 5 (4 Linear + 1 Slack)
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import {
  CODER_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
} from "../../dev-agent/orchestrator/system-prompts.js";
import type { TokenBudget } from "../agent-loop/token-budget.js";
import type { ToolDefinition } from "../agent-loop/types.js";
import type { TraceRecorderCallbacks } from "../db/trace-recorder.js";
import {
  createListDirectoryTool,
  createReadFileTool,
  createRunCommandTool,
  createSearchCodebaseTool,
  createWriteFileTool,
} from "./codebase/index.js";
import type { AgentTypeConfig, SpawnAgentDeps } from "./coordination/index.js";
import {
  createRequestHumanInputTool,
  createSpawnAgentTool,
} from "./coordination/index.js";
import type { McpToolDeps } from "./integration/index.js";
import {
  createGitHubTools,
  createLinearTools,
  createSlackTools,
} from "./integration/index.js";
import type { CodebaseToolDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Dependencies for toolkit construction.
 * Provides everything needed to create tools for any agent type.
 */
export interface ToolkitDeps {
  /** Container manager for codebase tool execution */
  containerManager: DevContainerManager;
  /** Task ID identifying which dev container to use */
  taskId: string;
  /** Agent identifier for MCP permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Logger for tool execution */
  logger: PinoLogger;
  /** Shared mutable token budget */
  tokenBudget: TokenBudget;
  /** Optional abort signal for clean cancellation */
  abortSignal?: AbortSignal;
  /** Trace recorder for observability */
  traceRecorder: TraceRecorderCallbacks;
}

// ---------------------------------------------------------------------------
// Helper: Build dependency objects from ToolkitDeps
// ---------------------------------------------------------------------------

function buildCodebaseDeps(deps: ToolkitDeps): CodebaseToolDeps {
  return {
    containerManager: deps.containerManager,
    taskId: deps.taskId,
    logger: deps.logger,
  };
}

function buildMcpDeps(deps: ToolkitDeps): McpToolDeps {
  return {
    agentId: deps.agentId,
    correlationId: deps.correlationId,
  };
}

// ---------------------------------------------------------------------------
// Sub-Agent Toolkits
// ---------------------------------------------------------------------------

/**
 * Create the researcher toolkit.
 *
 * 4 tools: read_file, search_codebase, list_directory, run_command
 * Designed for exploring code structure and gathering information.
 */
export function createResearcherToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = buildCodebaseDeps(deps);
  return [
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createListDirectoryTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),
  ];
}

/**
 * Create the coder toolkit.
 *
 * 4 tools: read_file, write_file, search_codebase, run_command
 * Designed for implementing code changes.
 */
export function createCoderToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = buildCodebaseDeps(deps);
  return [
    createReadFileTool(codebaseDeps),
    createWriteFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),
  ];
}

/**
 * Create the tester toolkit.
 *
 * 3 tools: read_file, search_codebase, run_command
 * Designed for running tests and diagnosing failures.
 */
export function createTesterToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = buildCodebaseDeps(deps);
  return [
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),
  ];
}

// ---------------------------------------------------------------------------
// Orchestrator Toolkit
// ---------------------------------------------------------------------------

/**
 * Create the orchestrator toolkit.
 *
 * 13 tools total:
 * - 3 codebase: read_file, search_codebase, list_directory (NO write_file, NO run_command)
 * - 2 coordination: spawn_agent, request_human_input
 * - 2 Linear: linear_get_issue, linear_update_issue_status
 * - 4 GitHub: github_create_branch, github_create_commit, github_create_pull_request,
 *             github_get_pull_request
 * - 2 Slack: slack_send_message, slack_send_approval_request
 *
 * Note: merge_pull_request is intentionally excluded -- humans review and merge PRs.
 * The tool definition exists in github-tools.ts for MCP (defense-in-depth).
 *
 * The orchestrator delegates write and run operations to sub-agents via spawn_agent.
 */
export function createOrchestratorToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = buildCodebaseDeps(deps);
  const mcpDeps = buildMcpDeps(deps);

  // Codebase tools (read-only for the orchestrator)
  const codebaseTools = [
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createListDirectoryTool(codebaseDeps),
  ];

  // Build sub-agent configs for spawn_agent
  const subAgentConfigs: Record<string, AgentTypeConfig> = {
    researcher: {
      systemPrompt: RESEARCHER_SYSTEM_PROMPT,
      tools: createResearcherToolkit(deps),
      maxIterations: 30,
      model: "claude-haiku-4-5-20251001",
    },
    coder: {
      systemPrompt: CODER_SYSTEM_PROMPT,
      tools: createCoderToolkit(deps),
      maxIterations: 40,
      model: "claude-haiku-4-5-20251001",
    },
    tester: {
      systemPrompt: TESTER_SYSTEM_PROMPT,
      tools: createTesterToolkit(deps),
      maxIterations: 20,
      model: "claude-haiku-4-5-20251001",
    },
  };

  // Coordination tools -- use mutable-then-conditional-set for exactOptionalPropertyTypes
  const spawnDeps: SpawnAgentDeps = {
    agentTypes: subAgentConfigs,
    tokenBudget: deps.tokenBudget,
    traceRecorder: deps.traceRecorder,
    logger: deps.logger,
  };
  if (deps.abortSignal !== undefined) {
    spawnDeps.abortSignal = deps.abortSignal;
  }

  const coordinationTools = [
    createSpawnAgentTool(spawnDeps),
    createRequestHumanInputTool(),
  ];

  // Integration tools (filtered subsets)
  const allLinear = createLinearTools(mcpDeps);
  const allGitHub = createGitHubTools(mcpDeps);
  const allSlack = createSlackTools(mcpDeps);

  const orchestratorLinear = allLinear.filter((t) =>
    ["linear_get_issue", "linear_update_issue_status"].includes(t.name),
  );
  const orchestratorGitHub = allGitHub.filter((t) =>
    [
      "github_create_branch",
      "github_create_commit",
      "github_create_pull_request",
      "github_get_pull_request",
    ].includes(t.name),
  );
  const orchestratorSlack = allSlack.filter((t) =>
    ["slack_send_message", "slack_send_approval_request"].includes(t.name),
  );

  return [
    ...codebaseTools,
    ...coordinationTools,
    ...orchestratorLinear,
    ...orchestratorGitHub,
    ...orchestratorSlack,
  ];
}

// ---------------------------------------------------------------------------
// Product Agent Toolkit
// ---------------------------------------------------------------------------

/**
 * Dependencies for the product agent toolkit.
 * Simpler than ToolkitDeps since the product agent does not need codebase tools,
 * coordination tools, container management, token budgets, or trace recording.
 */
export interface ProductAgentToolkitDeps {
  /** Agent identifier for MCP permission checks */
  agentId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
}

/**
 * Create the product agent toolkit.
 *
 * 5 tools total:
 * - 4 Linear: linear_create_issue, linear_get_issue, linear_list_labels, linear_search_issues
 * - 1 Slack: slack_send_message
 *
 * The product agent communicates via Slack and creates Linear issues -- no codebase
 * tools, GitHub tools, or coordination tools (spawn_agent, request_human_input).
 */
export function createProductAgentToolkit(
  deps: ProductAgentToolkitDeps,
): ToolDefinition[] {
  const mcpDeps: McpToolDeps = {
    agentId: deps.agentId,
    correlationId: deps.correlationId,
  };

  const linearTools = createLinearTools(mcpDeps).filter((t) =>
    [
      "linear_create_issue",
      "linear_get_issue",
      "linear_list_labels",
      "linear_search_issues",
    ].includes(t.name),
  );

  const slackTools = createSlackTools(mcpDeps).filter((t) =>
    ["slack_send_message"].includes(t.name),
  );

  return [...linearTools, ...slackTools];
}
