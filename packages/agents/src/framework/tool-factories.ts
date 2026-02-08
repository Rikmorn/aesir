/**
 * Tool Factory Registration
 *
 * Registers all 36 tool factories in the ToolRegistry, bridging the v2.3
 * ToolContext interface to the existing v2.2 tool factory signatures.
 *
 * Tool categories:
 * - Codebase (5): read_file, write_file, search_codebase, list_directory, run_command
 * - Linear (7): get_issue, create_issue, update_issue_status, list_teams, list_labels, search_issues, create_comment
 * - GitHub (10): get_repository, create_branch, create_commit, create_pull_request,
 *                get_pull_request, list_pull_requests, merge_pull_request, get_file_contents, list_files, create_pr_comment
 * - Slack (5): send_message, send_approval_request, get_message, reply_to_thread, list_channels
 * - Coordination (3): spawn_agent, request_human_input, wait_for
 * - Task (6): create_task, complete_task, pause_task, handoff_task, list_tasks, get_task_context
 *
 * Adapters bridge ToolContext to the existing factory signatures:
 * - Codebase adapter: extracts containerManager, sandboxId, logger from ToolContext
 * - MCP adapter: extracts agentId, correlationId from ToolContext
 * - Coordination tools are either context-free or use placeholder implementations
 * - Task tools take (TaskService, ToolContext) directly
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import type { TaskService } from "../shared/services/task-service.js";
import {
  createListDirectoryTool,
  createReadFileTool,
  createRunCommandTool,
  createSearchCodebaseTool,
  createWriteFileTool,
} from "../shared/tools/codebase/index.js";
import { createRequestHumanInputTool } from "../shared/tools/coordination/index.js";
import { createSpawnAgentTool } from "../shared/tools/coordination/spawn-agent.js";
import { createGitHubTools } from "../shared/tools/integration/github-tools.js";
import { createLinearTools } from "../shared/tools/integration/linear-tools.js";
import type { McpToolDeps } from "../shared/tools/integration/mcp-wrapper.js";
import { createSlackTools } from "../shared/tools/integration/slack-tools.js";
import {
  createCompleteTaskTool,
  createCreateTaskTool,
  createGetTaskContextTool,
  createHandoffTaskTool,
  createListTasksTool,
  createPauseTaskTool,
} from "../shared/tools/task/index.js";
import type { CodebaseToolDeps } from "../shared/tools/types.js";
import type { AgentRegistry, ToolContext, ToolRegistry } from "./types.js";
import {
  createDefaultWaitForState,
  createWaitForTool,
} from "./wait-for-tool.js";

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Options for registerAllTools().
 */
export interface RegisterAllToolsOptions {
  /** ToolRegistry instance to populate */
  registry: ToolRegistry;
  /** AgentRegistry for spawn_agent sub-agent resolution (Phase 40) */
  agentRegistry: AgentRegistry;
  /** TaskService for task lifecycle operations (Phase 58.2) */
  taskService: TaskService;
  /** Logger for registration diagnostics */
  logger: PinoLogger;
}

// ─── Adapters ────────────────────────────────────────────────────────────────

/**
 * Adapter that bridges ToolContext to CodebaseToolDeps.
 *
 * Extracts containerManager, sandboxId, and logger from the ToolContext
 * and passes them to the existing codebase tool factory function.
 */
function codebaseAdapter(
  createFn: (deps: CodebaseToolDeps) => ToolDefinition,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) =>
    createFn({
      // Type assertions are safe here: agents that use codebase tools
      // always have containerManager and sandboxId set in their ToolContext.
      // If missing, the runtime error is intentional (misconfigured agent).
      containerManager: ctx.containerManager as DevContainerManager,
      sandboxId: ctx.sandboxId as string,
      logger: ctx.logger,
    });
}

/**
 * Adapter that bridges ToolContext to McpToolDeps and finds a specific tool.
 *
 * Calls the MCP factory to create all tools for that integration, then
 * finds the one matching displayName. This is less efficient than creating
 * individual tools, but preserves compatibility with the existing factory
 * pattern where tools are created as a batch.
 */
function mcpAdapter(
  createFn: (deps: McpToolDeps) => ToolDefinition[],
  displayName: string,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) => {
    const allTools = createFn({
      agentId: ctx.agentId,
      correlationId: ctx.correlationId,
      taskId: ctx.taskId,
    });
    const tool = allTools.find((t) => t.name === displayName);
    if (!tool) {
      throw new Error(
        `MCP tool "${displayName}" not found in factory output. ` +
          `Available: [${allTools.map((t) => t.name).join(", ")}]`,
      );
    }
    return tool;
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register all 36 tool factories in the ToolRegistry.
 *
 * This bridges the v2.3 registry-based tool resolution to the existing v2.2
 * tool factory functions. After calling this, `registry.resolve(refs, context)`
 * produces the exact same ToolDefinition[] as the current toolkit factories.
 *
 * @param options - Registry, agent registry, task service, and logger
 */
export function registerAllTools(options: RegisterAllToolsOptions): void {
  const { registry, logger } = options;

  // ── Codebase tools (5) ──────────────────────────────────────────────────

  registry.register("codebase:read_file", codebaseAdapter(createReadFileTool));
  registry.register(
    "codebase:write_file",
    codebaseAdapter(createWriteFileTool),
  );
  registry.register(
    "codebase:search_codebase",
    codebaseAdapter(createSearchCodebaseTool),
  );
  registry.register(
    "codebase:list_directory",
    codebaseAdapter(createListDirectoryTool),
  );
  registry.register(
    "codebase:run_command",
    codebaseAdapter(createRunCommandTool),
  );

  // ── Linear tools (7) ───────────────────────────────────────────────────

  registry.register(
    "linear:get_issue",
    mcpAdapter(createLinearTools, "linear_get_issue"),
  );
  registry.register(
    "linear:create_issue",
    mcpAdapter(createLinearTools, "linear_create_issue"),
  );
  registry.register(
    "linear:update_issue_status",
    mcpAdapter(createLinearTools, "linear_update_issue_status"),
  );
  registry.register(
    "linear:list_teams",
    mcpAdapter(createLinearTools, "linear_list_teams"),
  );
  registry.register(
    "linear:list_labels",
    mcpAdapter(createLinearTools, "linear_list_labels"),
  );
  registry.register(
    "linear:search_issues",
    mcpAdapter(createLinearTools, "linear_search_issues"),
  );
  registry.register(
    "linear:create_comment",
    mcpAdapter(createLinearTools, "linear_create_comment"),
  );

  // ── GitHub tools (10) ──────────────────────────────────────────────────

  registry.register(
    "github:get_repository",
    mcpAdapter(createGitHubTools, "github_get_repository"),
  );
  registry.register(
    "github:create_branch",
    mcpAdapter(createGitHubTools, "github_create_branch"),
  );
  registry.register(
    "github:create_commit",
    mcpAdapter(createGitHubTools, "github_create_commit"),
  );
  registry.register(
    "github:create_pull_request",
    mcpAdapter(createGitHubTools, "github_create_pull_request"),
  );
  registry.register(
    "github:get_pull_request",
    mcpAdapter(createGitHubTools, "github_get_pull_request"),
  );
  registry.register(
    "github:list_pull_requests",
    mcpAdapter(createGitHubTools, "github_list_pull_requests"),
  );
  registry.register(
    "github:merge_pull_request",
    mcpAdapter(createGitHubTools, "github_merge_pull_request"),
  );
  registry.register(
    "github:get_file_contents",
    mcpAdapter(createGitHubTools, "github_get_file_contents"),
  );
  registry.register(
    "github:list_files",
    mcpAdapter(createGitHubTools, "github_list_files"),
  );
  registry.register(
    "github:create_pr_comment",
    mcpAdapter(createGitHubTools, "github_create_pr_comment"),
  );

  // ── Slack tools (5) ────────────────────────────────────────────────────

  registry.register(
    "slack:send_message",
    mcpAdapter(createSlackTools, "slack_send_message"),
  );
  registry.register(
    "slack:send_approval_request",
    mcpAdapter(createSlackTools, "slack_send_approval_request"),
  );
  registry.register(
    "slack:get_message",
    mcpAdapter(createSlackTools, "slack_get_message"),
  );
  registry.register(
    "slack:reply_to_thread",
    mcpAdapter(createSlackTools, "slack_reply_to_thread"),
  );
  registry.register(
    "slack:list_channels",
    mcpAdapter(createSlackTools, "slack_list_channels"),
  );

  // ── Coordination tools (3) ─────────────────────────────────────────────

  // request_human_input -- stateless, no context dependencies
  registry.register("coordination:request_human_input", () =>
    createRequestHumanInputTool(),
  );

  // spawn_agent -- real implementation using createSpawnAgentTool
  // When spawnDeps is populated in ToolContext (by the worker loop),
  // the tool spawns sub-agents as nested runAgentLoop() calls.
  // When spawnDeps is absent, the tool returns a descriptive error.
  registry.register("coordination:spawn_agent", (ctx: ToolContext) =>
    createSpawnAgentTool(ctx),
  );

  // wait_for -- real implementation from Phase 40
  // Creates a default WaitForState so the tool resolves correctly in the registry.
  // When the executor runs, it replaces the execute function with one bound to
  // a per-conversation WaitForState. Outside the executor, the tool still works
  // but the state goes nowhere useful.
  registry.register("coordination:wait_for", (_ctx: ToolContext) => {
    const defaultState = createDefaultWaitForState();
    return createWaitForTool(defaultState);
  });

  // ── Task tools (6) ──────────────────────────────────────────────────

  const ts = options.taskService;
  registry.register("task:create_task", (ctx) => createCreateTaskTool(ts, ctx));
  registry.register("task:complete_task", (ctx) =>
    createCompleteTaskTool(ts, ctx),
  );
  registry.register("task:pause_task", (ctx) => createPauseTaskTool(ts, ctx));
  registry.register("task:handoff_task", (ctx) =>
    createHandoffTaskTool(ts, ctx),
  );
  registry.register("task:list_tasks", (ctx) => createListTasksTool(ts, ctx));
  registry.register("task:get_task_context", (ctx) =>
    createGetTaskContextTool(ts, ctx),
  );

  // ── Summary ────────────────────────────────────────────────────────────

  logger.info(
    { toolCount: registry.listRegistered().length },
    "All tool factories registered",
  );
}
