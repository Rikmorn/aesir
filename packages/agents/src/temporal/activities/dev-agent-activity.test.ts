/**
 * Dev Agent Activity Tests
 *
 * Tests for the executeDevWorkflow activity.
 * Mocks runDevWorkflow to verify activity behavior.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DevWorkflowDependencies,
  DevWorkflowResult,
} from "../../dev-workflow-runner.js";
import { executeDevWorkflow } from "./dev-agent-activity.js";

// Mock the dev-workflow-runner module
vi.mock("../../dev-workflow-runner.js", () => ({
  runDevWorkflow: vi.fn(),
}));

// Import the mocked function
import { runDevWorkflow } from "../../dev-workflow-runner.js";

describe("executeDevWorkflow", () => {
  const mockDeps: DevWorkflowDependencies = {
    sandbox: {} as DevWorkflowDependencies["sandbox"],
    githubConfig: {
      owner: "test-owner",
      repo: "test-repo",
      baseBranch: "main",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runDevWorkflow with taskId and deps", async () => {
    const mockResult: DevWorkflowResult = {
      success: true,
      status: "complete",
      durationMs: 5000,
    };
    vi.mocked(runDevWorkflow).mockResolvedValue(mockResult);

    await executeDevWorkflow("TASK-123", "session-123", mockDeps);

    expect(runDevWorkflow).toHaveBeenCalledWith(
      "TASK-123",
      "session-123",
      mockDeps,
    );
  });

  it("returns result unchanged on success", async () => {
    const mockResult: DevWorkflowResult = {
      success: true,
      status: "complete",
      prNumber: 42,
      durationMs: 5000,
    };
    vi.mocked(runDevWorkflow).mockResolvedValue(mockResult);

    const result = await executeDevWorkflow(
      "TASK-123",
      "session-123",
      mockDeps,
    );

    expect(result).toEqual(mockResult);
    expect(result.success).toBe(true);
    expect(result.prNumber).toBe(42);
  });

  it("returns result unchanged on failure", async () => {
    const mockResult: DevWorkflowResult = {
      success: false,
      status: "failed",
      error: "Something went wrong",
      durationMs: 1000,
    };
    vi.mocked(runDevWorkflow).mockResolvedValue(mockResult);

    const result = await executeDevWorkflow(
      "TASK-456",
      "session-456",
      mockDeps,
    );

    expect(result).toEqual(mockResult);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Something went wrong");
  });

  it("propagates errors from runDevWorkflow", async () => {
    const error = new Error("Workflow crashed");
    vi.mocked(runDevWorkflow).mockRejectedValue(error);

    await expect(
      executeDevWorkflow("TASK-789", "session-789", mockDeps),
    ).rejects.toThrow("Workflow crashed");
  });
});
