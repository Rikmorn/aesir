/**
 * Tool Factory Registration Tests
 *
 * Tests for registerAllTools() covering: factory registration counts,
 * namespace verification, tool resolution, placeholder behavior,
 * and Anthropic-compatible tool name format validation.
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import type { DirectoryService } from "../shared/services/directory-service.js";
import type { KnowledgeService } from "../shared/services/knowledge-service.js";
import type { TaskService } from "../shared/services/task-service.js";
import { registerAllTools } from "./tool-factories.js";
import { createToolRegistry } from "./tool-registry.js";
import type { AgentDefinition, AgentRegistry, ToolContext } from "./types.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockLogger(): PinoLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    level: "debug",
    silent: vi.fn(),
  } as unknown as PinoLogger;
}

function createMockAgentRegistry(): AgentRegistry {
  return {
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([] as AgentDefinition[]),
  };
}

function createMockTaskService(): TaskService {
  return {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    addHandoff: vi.fn(),
    getHandoffs: vi.fn(),
    getLatestHandoff: vi.fn(),
    listByAssignee: vi.fn(),
    listByParent: vi.fn(),
    linkConversation: vi.fn(),
    setDispatcher: vi.fn(),
    health: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
    close: vi.fn(),
  } as unknown as TaskService;
}

function createMockKnowledgeService(): KnowledgeService {
  return {
    store: vi.fn(),
    query: vi.fn(),
    supersede: vi.fn(),
    invalidate: vi.fn(),
    cleanupExpired: vi.fn(),
    health: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
    close: vi.fn(),
  } as unknown as KnowledgeService;
}

function createMockDirectoryService(): DirectoryService {
  return {
    find: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    deactivateStale: vi.fn().mockResolvedValue(0),
    health: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
    close: vi.fn(),
  } as unknown as DirectoryService;
}

function createMockContext(): ToolContext {
  return {
    agentId: "test-agent",
    correlationId: "test-correlation",
    containerManager: {
      execute: vi.fn(),
    } as unknown as DevContainerManager,
    sandboxId: "test-task",
    logger: createMockLogger(),
  };
}

/**
 * Helper: create a registry and register all tools.
 */
function setupRegistry() {
  const logger = createMockLogger();
  const registry = createToolRegistry({ logger });
  const agentRegistry = createMockAgentRegistry();
  const taskService = createMockTaskService();
  const knowledgeService = createMockKnowledgeService();
  const directoryService = createMockDirectoryService();
  registerAllTools({
    registry,
    agentRegistry,
    taskService,
    knowledgeService,
    directoryService,
    logger,
  });
  return {
    registry,
    logger,
    agentRegistry,
    taskService,
    knowledgeService,
    directoryService,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerAllTools", () => {
  // ── Registration ─────────────────────────────────────────────────────────

  describe("registration", () => {
    it("should register all tool factories without error", () => {
      expect(() => setupRegistry()).not.toThrow();
    });

    it("should register exactly 47 tools", () => {
      const { registry } = setupRegistry();
      expect(registry.listRegistered()).toHaveLength(47);
    });

    it("should register all expected namespaces", () => {
      const { registry } = setupRegistry();
      const registered = registry.listRegistered();

      const namespaces = new Set(registered.map((ref) => ref.split(":")[0]));
      expect(namespaces).toEqual(
        new Set([
          "codebase",
          "linear",
          "github",
          "slack",
          "coordination",
          "task",
          "knowledge",
          "directory",
          "communication",
        ]),
      );
    });
  });

  // ── Expected Tool List ───────────────────────────────────────────────────

  describe("expected tool list", () => {
    it("should register all codebase tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("codebase:read_file")).toBe(true);
      expect(registry.has("codebase:write_file")).toBe(true);
      expect(registry.has("codebase:search_codebase")).toBe(true);
      expect(registry.has("codebase:list_directory")).toBe(true);
      expect(registry.has("codebase:run_command")).toBe(true);
    });

    it("should register all linear tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("linear:get_issue")).toBe(true);
      expect(registry.has("linear:create_issue")).toBe(true);
      expect(registry.has("linear:update_issue_status")).toBe(true);
      expect(registry.has("linear:list_teams")).toBe(true);
      expect(registry.has("linear:list_labels")).toBe(true);
      expect(registry.has("linear:search_issues")).toBe(true);
      expect(registry.has("linear:create_comment")).toBe(true);
    });

    it("should register all github tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("github:get_repository")).toBe(true);
      expect(registry.has("github:create_branch")).toBe(true);
      expect(registry.has("github:create_commit")).toBe(true);
      expect(registry.has("github:create_pull_request")).toBe(true);
      expect(registry.has("github:get_pull_request")).toBe(true);
      expect(registry.has("github:list_pull_requests")).toBe(true);
      expect(registry.has("github:merge_pull_request")).toBe(true);
      expect(registry.has("github:get_file_contents")).toBe(true);
      expect(registry.has("github:list_files")).toBe(true);
      expect(registry.has("github:create_pr_comment")).toBe(true);
    });

    it("should register all slack tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("slack:send_message")).toBe(true);
      expect(registry.has("slack:send_approval_request")).toBe(true);
      expect(registry.has("slack:get_message")).toBe(true);
      expect(registry.has("slack:reply_to_thread")).toBe(true);
      expect(registry.has("slack:list_channels")).toBe(true);
    });

    it("should register all coordination tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("coordination:spawn_agent")).toBe(true);
      expect(registry.has("coordination:request_human_input")).toBe(true);
      expect(registry.has("coordination:wait_for")).toBe(true);
      expect(registry.has("coordination:wait_for_task")).toBe(true);
    });

    it("should register all task tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("task:create_task")).toBe(true);
      expect(registry.has("task:complete_task")).toBe(true);
      expect(registry.has("task:pause_task")).toBe(true);
      expect(registry.has("task:handoff_task")).toBe(true);
      expect(registry.has("task:list_tasks")).toBe(true);
      expect(registry.has("task:get_task_context")).toBe(true);
    });

    it("should register all knowledge tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("knowledge:store")).toBe(true);
      expect(registry.has("knowledge:query")).toBe(true);
      expect(registry.has("knowledge:update")).toBe(true);
    });

    it("should register all directory tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("directory:find")).toBe(true);
      expect(registry.has("directory:get")).toBe(true);
    });

    it("should register all communication tools", () => {
      const { registry } = setupRegistry();

      expect(registry.has("communication:reply")).toBe(true);
      expect(registry.has("communication:ask")).toBe(true);
      expect(registry.has("communication:notify")).toBe(true);
    });
  });

  // ── Resolution ───────────────────────────────────────────────────────────

  describe("resolution", () => {
    it("should resolve codebase tools to ToolDefinitions with correct names", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const tools = registry.resolve(["codebase:read_file"], ctx);

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("read_file");
    });

    it("should resolve MCP tools to ToolDefinitions with underscore display names", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const tools = registry.resolve(["linear:get_issue"], ctx);

      expect(tools).toHaveLength(1);
      // Display name uses underscore format (not colon)
      expect(tools[0]?.name).toBe("linear_get_issue");
    });

    it("should resolve coordination:request_human_input to working tool", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const tools = registry.resolve(["coordination:request_human_input"], ctx);

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("request_human_input");
    });

    it("should resolve communication tools to ToolDefinitions with underscore names", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const tools = registry.resolve(["communication:reply"], ctx);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("communication_reply");
    });
  });

  // ── Placeholders ─────────────────────────────────────────────────────────

  describe("placeholders", () => {
    it("should resolve coordination:wait_for to real tool that returns confirmation", async () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const tools = registry.resolve(["coordination:wait_for"], ctx);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("wait_for");

      const result = await tools[0]?.execute({
        type: "approval",
        reason: "Need human review",
      });

      // Real tool returns a confirmation message (not an error)
      expect(result?.isError).toBeUndefined();
      expect(result?.content).toContain("Conversation paused");
      expect(result?.content).toContain("approval");
    });

    it("should resolve coordination:spawn_agent to tool that returns error when spawnDeps absent", async () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();
      // ctx has no spawnDeps, so spawn_agent should return an error

      const tools = registry.resolve(["coordination:spawn_agent"], ctx);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("spawn_agent");

      const result = await tools[0]?.execute({
        agentType: "researcher",
        task: "test task",
      });

      expect(result?.isError).toBe(true);
      expect(result?.content).toContain("not available in this context");
    });
  });

  // ── Tool Name Format ───────────────────────────────────────────────────

  describe("tool name format", () => {
    it("should produce ToolDefinitions with Anthropic-compatible names (no colons)", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const allRefs = registry.listRegistered();
      const tools = registry.resolve(allRefs, ctx);

      // Anthropic tool name regex: ^[a-zA-Z0-9_-]{1,64}$
      const nameRegex = /^[a-zA-Z0-9_-]{1,64}$/;

      for (const tool of tools) {
        expect(
          nameRegex.test(tool.name),
          `Tool name "${tool.name}" does not match Anthropic name format`,
        ).toBe(true);
      }
    });

    it("should not have any tool names containing colons", () => {
      const { registry } = setupRegistry();
      const ctx = createMockContext();

      const allRefs = registry.listRegistered();
      const tools = registry.resolve(allRefs, ctx);

      for (const tool of tools) {
        expect(tool.name).not.toContain(":");
      }
    });
  });

  // ── Logging ────────────────────────────────────────────────────────────

  describe("logging", () => {
    it("should log tool count after registration", () => {
      const { logger } = setupRegistry();

      expect(logger.info).toHaveBeenCalledWith(
        { toolCount: 47 },
        "All tool factories registered",
      );
    });
  });
});
