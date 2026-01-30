/**
 * Toolkits Tests
 *
 * Unit tests for per-agent toolkit factory functions.
 * Verifies each toolkit returns the exact set of tools specified for its agent type.
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceRecorderCallbacks } from "../db/trace-recorder.js";
import type { ToolkitDeps } from "./toolkits.js";
import {
  createCoderToolkit,
  createOrchestratorToolkit,
  createResearcherToolkit,
  createTesterToolkit,
} from "./toolkits.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn().mockResolvedValue({
    status: "completed",
    output: "done",
    toolCallCount: 0,
    tokenCount: { input: 0, output: 0 },
    trace: [],
  }),
}));

vi.mock("../mcp/client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aesir/types", () => ({
  createId: {
    agentInstance: () => "ainst_test_toolkit",
  },
}));

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockToolkitDeps(): ToolkitDeps {
  return {
    containerManager: {
      execute: vi.fn(),
      spawn: vi.fn(),
      findByTaskId: vi.fn(),
      isRunning: vi.fn(),
      health: vi.fn(),
      close: vi.fn(),
    } as unknown as DevContainerManager,
    taskId: "test-task-456",
    agentId: "test-orchestrator",
    correlationId: "corr-789",
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as PinoLogger,
    tokenBudget: {
      total: 500_000,
      remaining: 500_000,
      isExhausted: vi.fn().mockReturnValue(false),
      isWarning: vi.fn().mockReturnValue(false),
      isReserveOnly: vi.fn().mockReturnValue(false),
      warningFired: false,
      deduct: vi.fn(),
    },
    traceRecorder: {
      onToolCall: vi.fn(),
      onResponse: vi.fn(),
      onAgentSpawn: vi.fn(),
      onAgentComplete: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      stepCount: vi.fn().mockReturnValue(0),
    } as TraceRecorderCallbacks,
  };
}

// ---------------------------------------------------------------------------
// createResearcherToolkit
// ---------------------------------------------------------------------------

describe("createResearcherToolkit", () => {
  let deps: ToolkitDeps;

  beforeEach(() => {
    deps = createMockToolkitDeps();
  });

  it("returns exactly 4 tools", () => {
    const tools = createResearcherToolkit(deps);
    expect(tools).toHaveLength(4);
  });

  it("returns tools with correct names", () => {
    const tools = createResearcherToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "read_file",
      "search_codebase",
      "list_directory",
      "run_command",
    ]);
  });

  it("does NOT include write_file", () => {
    const tools = createResearcherToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
  });
});

// ---------------------------------------------------------------------------
// createCoderToolkit
// ---------------------------------------------------------------------------

describe("createCoderToolkit", () => {
  let deps: ToolkitDeps;

  beforeEach(() => {
    deps = createMockToolkitDeps();
  });

  it("returns exactly 4 tools", () => {
    const tools = createCoderToolkit(deps);
    expect(tools).toHaveLength(4);
  });

  it("returns tools with correct names", () => {
    const tools = createCoderToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "read_file",
      "write_file",
      "search_codebase",
      "run_command",
    ]);
  });

  it("does NOT include list_directory", () => {
    const tools = createCoderToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("list_directory");
  });
});

// ---------------------------------------------------------------------------
// createTesterToolkit
// ---------------------------------------------------------------------------

describe("createTesterToolkit", () => {
  let deps: ToolkitDeps;

  beforeEach(() => {
    deps = createMockToolkitDeps();
  });

  it("returns exactly 3 tools", () => {
    const tools = createTesterToolkit(deps);
    expect(tools).toHaveLength(3);
  });

  it("returns tools with correct names", () => {
    const tools = createTesterToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["read_file", "search_codebase", "run_command"]);
  });

  it("does NOT include write_file or list_directory", () => {
    const tools = createTesterToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("list_directory");
  });
});

// ---------------------------------------------------------------------------
// createOrchestratorToolkit
// ---------------------------------------------------------------------------

describe("createOrchestratorToolkit", () => {
  let deps: ToolkitDeps;

  beforeEach(() => {
    deps = createMockToolkitDeps();
  });

  it("returns exactly 13 tools", () => {
    const tools = createOrchestratorToolkit(deps);
    expect(tools).toHaveLength(13);
  });

  it("includes spawn_agent and request_human_input", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toContain("spawn_agent");
    expect(names).toContain("request_human_input");
  });

  it("does NOT include write_file or run_command", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_command");
  });

  it("includes correct codebase tool subset (read_file, search_codebase, list_directory)", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("search_codebase");
    expect(names).toContain("list_directory");
  });

  it("includes correct Linear tool subset", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toContain("linear_get_issue");
    expect(names).toContain("linear_update_issue_status");
    // Should NOT include other Linear tools
    expect(names).not.toContain("linear_create_issue");
    expect(names).not.toContain("linear_list_teams");
    expect(names).not.toContain("linear_list_labels");
  });

  it("includes correct GitHub tool subset (no merge)", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toContain("github_create_branch");
    expect(names).toContain("github_create_commit");
    expect(names).toContain("github_create_pull_request");
    expect(names).toContain("github_get_pull_request");
    // merge_pull_request intentionally excluded -- humans merge PRs
    expect(names).not.toContain("github_merge_pull_request");
    // Should NOT include other GitHub tools
    expect(names).not.toContain("github_get_repository");
    expect(names).not.toContain("github_list_pull_requests");
    expect(names).not.toContain("github_get_file_contents");
    expect(names).not.toContain("github_list_files");
  });

  it("includes correct Slack tool subset", () => {
    const tools = createOrchestratorToolkit(deps);
    const names = tools.map((t) => t.name);
    expect(names).toContain("slack_send_message");
    expect(names).toContain("slack_send_approval_request");
    // Should NOT include other Slack tools
    expect(names).not.toContain("slack_get_message");
    expect(names).not.toContain("slack_reply_to_thread");
    expect(names).not.toContain("slack_list_channels");
  });

  it("all tools have valid name, description, inputSchema, and execute function", () => {
    const tools = createOrchestratorToolkit(deps);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.execute).toBeTypeOf("function");
    }
  });
});
