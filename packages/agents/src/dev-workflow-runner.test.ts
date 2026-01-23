/**
 * Tests for Dev Workflow Runner
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
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

import { DEFAULT_DEV_WORKFLOW_CONFIG } from "@aesir/common";
import {
  type DevWorkflowDependencies,
  runDevWorkflow,
} from "./dev-workflow-runner.js";

// Mock Linear integration
vi.mock("@aesir/integration-linear", () => ({
  updateIssueStatus: vi.fn(),
  emitError: vi.fn(),
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

// Import dependencies after mocks
import { emitError, updateIssueStatus } from "@aesir/integration-linear";
import { createDevWorkflow } from "./dev-workflow.js";

const mockCreateDevWorkflow = vi.mocked(createDevWorkflow);
const mockUpdateIssueStatus = vi.mocked(updateIssueStatus);
const mockEmitError = vi.mocked(emitError);

describe("runDevWorkflow", () => {
  // Mock dependencies
  const mockLinearClient = {} as DevWorkflowDependencies["linearClient"];
  const mockOctokit = {} as DevWorkflowDependencies["octokit"];
  const mockSandbox = {
    cleanup: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    execute: vi.fn(),
    runTests: vi.fn(),
  } as unknown as DevWorkflowDependencies["sandbox"];

  const mockDeps: DevWorkflowDependencies = {
    linearClient: mockLinearClient,
    octokit: mockOctokit,
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
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitError.mockResolvedValue(undefined);

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
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitError.mockResolvedValue(undefined);

    await runDevWorkflow("ABC-123", "session-abc", mockDeps);

    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(
      mockLinearClient,
      "ABC-123",
      "Ready",
    );
    expect(mockEmitError).toHaveBeenCalledWith(
      mockLinearClient,
      "session-abc",
      "Dev workflow failed: Test error",
    );
  });

  it("should return error result on failure", async () => {
    const mockWorkflow = {
      invoke: vi.fn().mockRejectedValue(new Error("Test error")),
    };
    mockCreateDevWorkflow.mockReturnValue(
      mockWorkflow as unknown as ReturnType<typeof createDevWorkflow>,
    );
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitError.mockResolvedValue(undefined);

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
    mockUpdateIssueStatus.mockRejectedValue(new Error("Linear API error"));

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
