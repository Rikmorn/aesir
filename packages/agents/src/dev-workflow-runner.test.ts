/**
 * Tests for Dev Workflow Runner
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/types to prevent config validation
vi.mock("@aesir/types", () => ({
  DEFAULT_DEV_WORKFLOW_CONFIG: {
    maxTestAttempts: 5,
    testCommand: ["npm", "test"],
    recursionLimit: 50,
    timeoutMs: 300000,
  },
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(function (this: unknown) {
      return this;
    }),
  })),
  createTraceStore: vi.fn(() => ({
    append: vi.fn(),
    getByTaskId: vi.fn().mockReturnValue([]),
    getByWorkflowId: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    size: vi.fn().mockReturnValue(0),
  })),
}));

// Mock the dev-workflow module
vi.mock("./dev-workflow.js", () => ({
  createDevWorkflow: vi.fn(),
}));

import {
  type DevWorkflowDependencies,
  runDevWorkflow,
} from "./dev-workflow-runner.js";
import { DEFAULT_DEV_WORKFLOW_CONFIG } from "./state/index.js";

// Mock MCP client
vi.mock("./mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Mock tracing module
vi.mock("./tracing/index.js", () => ({
  createLangGraphTracer: vi.fn(() => ({
    name: "LangGraphTracer",
    handleChainStart: vi.fn(),
    handleChainEnd: vi.fn(),
    handleChainError: vi.fn(),
    handleLLMStart: vi.fn(),
    handleLLMEnd: vi.fn(),
    handleToolStart: vi.fn(),
    handleToolEnd: vi.fn(),
  })),
}));

import { createDevWorkflow } from "./dev-workflow.js";
// Import dependencies after mocks
import { callMcpTool } from "./mcp/index.js";

const mockCreateDevWorkflow = vi.mocked(createDevWorkflow);
const mockCallMcpTool = vi.mocked(callMcpTool);

describe("runDevWorkflow", () => {
  // Mock dependencies
  const mockSandbox = {
    cleanup: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    execute: vi.fn(),
    runTests: vi.fn(),
  } as unknown as DevWorkflowDependencies["sandbox"];

  const mockDeps: DevWorkflowDependencies = {
    sandbox: mockSandbox,
    githubConfig: {
      owner: "test-owner",
      repo: "test-repo",
      baseBranch: "main",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return success on happy path", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    const result = await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(result.success).toBe(true);
    expect(result.status).toBe("complete");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should clean up sandbox on success", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(mockSandbox.cleanup).toHaveBeenCalledTimes(1);
  });

  it("should clean up sandbox on failure", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockRejectedValue(new Error("Workflow failed")),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    mockCallMcpTool.mockResolvedValue(undefined);

    await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(mockSandbox.cleanup).toHaveBeenCalledTimes(1);
  });

  it("should update Linear status on failure", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockRejectedValue(new Error("Test error")),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    mockCallMcpTool.mockResolvedValue(undefined);

    await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(mockCallMcpTool).toHaveBeenCalledWith({
      integration: "linear",
      tool: "update_issue_status",
      params: { issueId: "ABC-123", status: "Ready" },
      agentId: "dev-agent",
      correlationId: "dev-workflow-ABC-123",
    });
  });

  it("should return error result on failure", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockRejectedValue(new Error("Test error")),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    mockCallMcpTool.mockResolvedValue(undefined);

    const result = await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Test error");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should pass recursion limit from config", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    const customConfig = {
      ...DEFAULT_DEV_WORKFLOW_CONFIG,
      recursionLimit: 100,
    };
    await runDevWorkflow("ABC-123", "session-abc", mockDeps, customConfig);

    expect(mockWorkflow.invoke).toHaveBeenCalledWith(
      { taskId: "ABC-123", sessionId: "session-abc", status: "pending" },
      {
        configurable: { thread_id: "ABC-123" },
        recursionLimit: 100,
        callbacks: expect.any(Array),
      },
    );
  });

  it("should handle non-complete status as not success", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "failed",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    const result = await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("should handle Linear update failures gracefully", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockRejectedValue(new Error("Workflow error")),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    mockCallMcpTool.mockRejectedValue(new Error("Linear API error"));

    // Should not throw, just log the warning
    const result = await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Workflow error");
    // Sandbox cleanup should still happen
    expect(mockSandbox.cleanup).toHaveBeenCalledTimes(1);
  });

  it("should handle sandbox cleanup failures gracefully", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    (mockSandbox.cleanup as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cleanup failed"),
    );

    // Should not throw, just log the error
    const result = await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(result.success).toBe(true);
    expect(result.status).toBe("complete");
    expect(mockSandbox.cleanup).toHaveBeenCalledTimes(1);
  });

  it("should create workflow with correct dependencies", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(mockCreateDevWorkflow).toHaveBeenCalledWith({
      deps: mockDeps,
      config: DEFAULT_DEV_WORKFLOW_CONFIG,
    });
  });

  it("should pass custom config to workflow creation", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockResolvedValue({
        status: "complete",
        taskId: "ABC-123",
      }),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );

    const customConfig = {
      ...DEFAULT_DEV_WORKFLOW_CONFIG,
      maxTestAttempts: 10,
    };
    await runDevWorkflow("ABC-123", "session-abc", mockDeps, customConfig);

    expect(mockCreateDevWorkflow).toHaveBeenCalledWith({
      deps: mockDeps,
      config: customConfig,
    });
  });
});
