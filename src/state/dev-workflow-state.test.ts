/**
 * Dev Workflow State Tests
 *
 * Tests for FileChangeSchema, DevWorkflowState, and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  FileChangeSchema,
  DevWorkflowStatusSchema,
  DevWorkflowState,
  DEFAULT_DEV_WORKFLOW_CONFIG,
  hasExceededTestLimit,
  didTestsPass,
  createDevWorkflowInitialState,
  type FileChange,
  type DevWorkflowStatus,
  type DevWorkflowStateType,
} from "./dev-workflow-state.js";

describe("FileChangeSchema", () => {
  it("validates valid file change with create operation", () => {
    const validInput: FileChange = {
      path: "src/utils/helper.ts",
      content: 'export function helper() { return "hello"; }',
      operation: "create",
    };

    const result = FileChangeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("src/utils/helper.ts");
      expect(result.data.operation).toBe("create");
    }
  });

  it("validates valid file change with update operation", () => {
    const validInput: FileChange = {
      path: "package.json",
      content: '{"name": "test"}',
      operation: "update",
    };

    const result = FileChangeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation).toBe("update");
    }
  });

  it("validates valid file change with delete operation", () => {
    const validInput: FileChange = {
      path: "deprecated/old-file.ts",
      content: "",
      operation: "delete",
    };

    const result = FileChangeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation).toBe("delete");
    }
  });

  it("rejects file change with missing path", () => {
    const invalidInput = {
      content: "some content",
      operation: "create",
    };

    const result = FileChangeSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it("rejects file change with missing content", () => {
    const invalidInput = {
      path: "src/file.ts",
      operation: "create",
    };

    const result = FileChangeSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it("rejects file change with invalid operation", () => {
    const invalidInput = {
      path: "src/file.ts",
      content: "content",
      operation: "rename", // Not a valid operation
    };

    const result = FileChangeSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it("rejects file change with missing operation", () => {
    const invalidInput = {
      path: "src/file.ts",
      content: "content",
    };

    const result = FileChangeSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });
});

describe("DevWorkflowStatusSchema", () => {
  it("validates all valid statuses", () => {
    const validStatuses: DevWorkflowStatus[] = [
      "pending",
      "coding",
      "testing",
      "fixing",
      "committing",
      "complete",
      "failed",
    ];

    for (const status of validStatuses) {
      const result = DevWorkflowStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = DevWorkflowStatusSchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_DEV_WORKFLOW_CONFIG", () => {
  it("has sensible default values", () => {
    expect(DEFAULT_DEV_WORKFLOW_CONFIG.maxTestAttempts).toBe(5);
    expect(DEFAULT_DEV_WORKFLOW_CONFIG.testCommand).toEqual(["npm", "test"]);
    expect(DEFAULT_DEV_WORKFLOW_CONFIG.recursionLimit).toBe(50);
    expect(DEFAULT_DEV_WORKFLOW_CONFIG.timeoutMs).toBe(300000);
  });
});

describe("DevWorkflowState defaults", () => {
  it("has correct default values via createDevWorkflowInitialState", () => {
    // Test defaults through the initial state factory function
    const state = createDevWorkflowInitialState("", "");

    expect(state.taskId).toBe("");
    expect(state.taskDescription).toBe("");
    expect(state.repositoryUrl).toBe(null);
    expect(state.branchName).toBe(null);
    expect(state.files).toEqual([]);
    expect(state.testResult).toBe(null);
    expect(state.testAttempts).toBe(0);
    expect(state.status).toBe("pending");
    expect(state.error).toBe(null);
  });
});

describe("hasExceededTestLimit", () => {
  it("returns false when under limit", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: null,
      testAttempts: 3,
      status: "testing",
      error: null,
    };

    expect(hasExceededTestLimit(state)).toBe(false);
  });

  it("returns true when at limit", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: null,
      testAttempts: 5,
      status: "testing",
      error: null,
    };

    expect(hasExceededTestLimit(state)).toBe(true);
  });

  it("returns true when over limit", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: null,
      testAttempts: 10,
      status: "testing",
      error: null,
    };

    expect(hasExceededTestLimit(state)).toBe(true);
  });

  it("uses custom config when provided", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: null,
      testAttempts: 3,
      status: "testing",
      error: null,
    };

    const customConfig = { ...DEFAULT_DEV_WORKFLOW_CONFIG, maxTestAttempts: 3 };
    expect(hasExceededTestLimit(state, customConfig)).toBe(true);
  });
});

describe("didTestsPass", () => {
  it("returns true when tests passed", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: {
        passed: true,
        exitCode: 0,
        stdout: "All tests passed",
        stderr: "",
        summary: "1 passed",
      },
      testAttempts: 1,
      status: "testing",
      error: null,
    };

    expect(didTestsPass(state)).toBe(true);
  });

  it("returns false when tests failed", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: {
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "Test failed",
        summary: "1 failed",
      },
      testAttempts: 1,
      status: "testing",
      error: null,
    };

    expect(didTestsPass(state)).toBe(false);
  });

  it("returns false when no test result", () => {
    const state: DevWorkflowStateType = {
      taskId: "test-1",
      taskDescription: "Test task",
      repositoryUrl: null,
      branchName: null,
      files: [],
      testResult: null,
      testAttempts: 0,
      status: "pending",
      error: null,
    };

    expect(didTestsPass(state)).toBe(false);
  });
});

describe("createDevWorkflowInitialState", () => {
  it("creates initial state with required fields", () => {
    const state = createDevWorkflowInitialState("TASK-123", "Implement feature X");

    expect(state.taskId).toBe("TASK-123");
    expect(state.taskDescription).toBe("Implement feature X");
    expect(state.repositoryUrl).toBe(null);
    expect(state.branchName).toBe(null);
    expect(state.files).toEqual([]);
    expect(state.testResult).toBe(null);
    expect(state.testAttempts).toBe(0);
    expect(state.status).toBe("pending");
    expect(state.error).toBe(null);
  });

  it("creates initial state with optional repository URL", () => {
    const state = createDevWorkflowInitialState(
      "TASK-456",
      "Fix bug Y",
      "owner/repo"
    );

    expect(state.taskId).toBe("TASK-456");
    expect(state.taskDescription).toBe("Fix bug Y");
    expect(state.repositoryUrl).toBe("owner/repo");
  });
});
